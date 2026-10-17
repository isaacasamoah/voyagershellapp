use crate::adoption::{Candidate, Handoff, NativeEvent, Process};
use anyhow::{Context, Result, bail, ensure};
use nix::libc;
use std::{
    fs::File,
    io::{Read, Write},
    os::fd::AsRawFd,
    sync::mpsc::RecvTimeoutError,
    time::{Duration, Instant},
};

pub struct Status {
    pub thread: Result<String>,
    pub output: Vec<u8>,
}

struct Display<'a> {
    candidate: &'a Candidate,
    observer: Handoff,
    original_open: bool,
    parser: vt100::Parser,
    output: Vec<u8>,
    observed: usize,
    size: libc::winsize,
    query: Vec<u8>,
}

#[derive(Debug)]
struct Composer {
    row: u16,
    cursor: (u16, u16),
    lines: Vec<String>,
    empty: bool,
}

impl Display<'_> {
    fn receive(&mut self, duration: Duration) -> Result<()> {
        let end = Instant::now() + duration;
        while Instant::now() < end {
            if !self.original_open {
                let mut poll = libc::pollfd {
                    fd: self.candidate.master.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                };
                if unsafe { libc::poll(&mut poll, 1, 0) } > 0 {
                    let mut bytes = [0; 16384];
                    let n = (&self.candidate.master).read(&mut bytes)?;
                    ensure!(n > 0, "native PTY ended during lookup");
                    self.output.extend_from_slice(&bytes[..n]);
                }
            }
            let bytes = match self.observer.events.recv_timeout(Duration::from_millis(10)) {
                Ok(NativeEvent::Output(bytes)) => bytes,
                Err(RecvTimeoutError::Timeout) => continue,
                Ok(NativeEvent::Failed(reason)) => bail!(reason),
                Ok(NativeEvent::Released) | Err(RecvTimeoutError::Disconnected) => {
                    bail!("native Codex ended during lookup")
                }
            };
            ensure!(
                self.observed + bytes.len() <= 1024 * 1024,
                "native identity output limit exceeded"
            );
            self.observed += bytes.len();
            for byte in &bytes {
                self.parser.process(&[*byte]);
                self.query.push(*byte);
                if self.query.len() > 6 {
                    self.query.remove(0);
                }
                if self.query.ends_with(b"\x1b[6n") {
                    let (row, col) = self.parser.screen().cursor_position();
                    (&self.candidate.master)
                        .write_all(format!("\x1b[{};{}R", row + 1, col + 1).as_bytes())?;
                }
            }
        }
        Ok(())
    }

    fn key(&mut self, bytes: &[u8]) -> Result<()> {
        (&self.candidate.master).write_all(bytes)?;
        self.receive(Duration::from_millis(200))
    }

    fn resize(&mut self, rows: u16, columns: u16) -> Result<()> {
        self.parser.screen_mut().set_size(rows, columns);
        let size = libc::winsize {
            ws_row: rows,
            ws_col: columns,
            ..self.size
        };
        ensure!(
            unsafe { libc::ioctl(self.candidate.master.as_raw_fd(), libc::TIOCSWINSZ, &size) } == 0,
            "native redraw failed"
        );
        self.receive(Duration::from_millis(160))
    }

    fn refresh(&mut self) -> Result<()> {
        self.resize(self.size.ws_row - 1, self.size.ws_col - 1)?;
        self.resize(self.size.ws_row, self.size.ws_col)
    }

    fn composer(&self) -> Result<Composer> {
        let screen = self.parser.screen();
        ensure!(
            !screen.hide_cursor(),
            "unsupported: native composer is not focused"
        );
        let (cursor_row, cursor_col) = screen.cursor_position();
        let rows: Vec<_> = screen.rows(0, self.size.ws_col).collect();
        let row = (0..=cursor_row)
            .rev()
            .find(|r| rows[*r as usize].starts_with("› "))
            .context("unsupported: native Codex composer is not visible")?;
        ensure!(
            row > self.size.ws_row / 2,
            "unsupported: native composer position"
        );
        let footer = rows
            .iter()
            .enumerate()
            .skip(cursor_row as usize + 1)
            .find(|(_, text)| text.starts_with("  ") && text.contains(" · "))
            .map(|(n, _)| n)
            .context("unsupported: native Codex footer is not visible")?;
        ensure!(
            footer >= row as usize + 2 && footer < self.size.ws_row as usize,
            "unsupported: native composer layout"
        );
        let footer_text = rows[footer..].join("\n").to_lowercase();
        ensure!(
            ![
                "voice",
                "recording",
                "insert",
                "normal",
                "search",
                "esc latest"
            ]
            .iter()
            .any(|s| footer_text.contains(s)),
            "unsupported: finish the native modal or editing mode before docking"
        );
        let mut lines = rows[row as usize..footer - 1].to_vec();
        while lines.len() > 1 && lines.last().is_some_and(|line| line.trim().is_empty()) {
            lines.pop();
        }
        let empty = cursor_row == row
            && cursor_col == 2
            && lines.len() == 1
            && (2..self.size.ws_col).all(|column| {
                screen.cell(row, column).is_some_and(|cell| {
                    !cell.has_contents() || cell.contents().trim().is_empty() || cell.dim()
                })
            });
        Ok(Composer {
            row,
            cursor: (cursor_row - row, cursor_col),
            lines,
            empty,
        })
    }

    fn wait_empty(&mut self) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if self.composer().is_ok_and(|c| c.empty) {
                return Ok(());
            }
            ensure!(
                Instant::now() < deadline,
                "native status command was not consumed"
            );
            self.receive(Duration::from_millis(50))?;
        }
    }

    fn restore(&mut self, before: &Composer) -> Result<()> {
        self.key(b"\x1b[A")?;
        let recalled = self.composer()?;
        let after = if recalled.lines == before.lines {
            recalled
        } else {
            ensure!(
                recalled
                    .lines
                    .first()
                    .is_some_and(|line| line.trim() == "› /status"),
                "native history changed; draft remains in Codex history"
            );
            self.key(b"\x1b[A")?;
            self.composer()?
        };
        ensure!(
            after.lines == before.lines,
            "native draft restoration could not be verified; draft remains in Codex history"
        );
        if after.cursor != before.cursor {
            let y = after.row + before.cursor.0 + 1;
            let x = before.cursor.1 + 1;
            self.key(format!("\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m").as_bytes())?;
            let deadline = Instant::now() + Duration::from_secs(1);
            while self.composer()?.cursor != before.cursor && Instant::now() < deadline {
                self.receive(Duration::from_millis(50))?;
            }
            ensure!(
                self.composer()?.cursor == before.cursor,
                "native draft cursor restoration failed: expected {:?}, observed {:?}, row {}",
                before.cursor,
                self.composer()?.cursor,
                after.row
            );
        }
        Ok(())
    }
}

impl Drop for Display<'_> {
    fn drop(&mut self) {
        unsafe {
            libc::ioctl(
                self.candidate.master.as_raw_fd(),
                libc::TIOCSWINSZ,
                &self.size,
            );
        }
    }
}

fn size(master: &File) -> Result<libc::winsize> {
    let mut size = libc::winsize {
        ws_row: 0,
        ws_col: 0,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    ensure!(
        unsafe { libc::ioctl(master.as_raw_fd(), libc::TIOCGWINSZ, &mut size) } == 0,
        "native size unavailable"
    );
    ensure!(
        (15..=300).contains(&size.ws_row) && (60..=500).contains(&size.ws_col),
        "unsupported: native terminal dimensions"
    );
    Ok(size)
}

pub fn read(
    candidate: &Candidate,
    handoff: Option<&Handoff>,
    frontend: &Process,
) -> Result<Status> {
    let _input = handoff.map(Handoff::hold_input).transpose()?;
    let size = size(&candidate.master)?;
    let mut display = Display {
        candidate,
        observer: Handoff::output(frontend)?,
        original_open: handoff.is_some(),
        parser: vt100::Parser::new(size.ws_row, size.ws_col, 0),
        output: Vec::new(),
        observed: 0,
        size,
        query: Vec::new(),
    };
    let thread = lookup(&mut display);
    Ok(Status {
        thread,
        output: std::mem::take(&mut display.output),
    })
}

fn lookup(display: &mut Display<'_>) -> Result<String> {
    display.receive(Duration::from_millis(100))?;
    display.refresh()?;
    let before = display.composer()?;
    if !before.empty {
        display.key(b"\x03")?;
        ensure!(
            display.composer()?.empty,
            "native draft was not retained; no status command sent"
        );
    }
    let result = (|| -> Result<String> {
        display.key(b"/status")?;
        ensure!(
            display
                .composer()?
                .lines
                .first()
                .is_some_and(|line| line.trim() == "› /status"),
            "native status command was not prepared; no submit key sent"
        );
        ensure!(
            display
                .parser
                .screen()
                .contents()
                .contains("show current session configuration"),
            "unsupported: native status command was not recognized; no submit key sent"
        );
        display.key(b"\r")?;
        display.wait_empty()?;
        display.refresh()?;
        let text = display.parser.screen().contents();
        let thread = text
            .lines()
            .rev()
            .find_map(|line| line.trim().strip_prefix("Session:").map(str::trim))
            .filter(|s| uuid::Uuid::parse_str(s).is_ok())
            .map(str::to_owned);
        thread.context("native status returned no conversation identity")
    })();
    if !before.empty {
        if !display.composer()?.empty {
            ensure!(
                display
                    .composer()?
                    .lines
                    .first()
                    .is_some_and(|line| line.trim() == "› /status"),
                "unexpected native input; saved draft remains in Codex history"
            );
            display.key(b"\x15")?;
            display.wait_empty()?;
        }
        display.restore(&before)?;
    }
    result
}
