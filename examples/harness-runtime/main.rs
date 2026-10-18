use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

struct Runtime {
    child: Child,
    input: ChildStdin,
    messages: Receiver<Value>,
    next_id: u64,
}

fn emit(value: &Value) -> Result<()> {
    let mut output = std::io::stdout().lock();
    serde_json::to_writer(&mut output, value)?;
    writeln!(output)?;
    output.flush()?;
    Ok(())
}

impl Runtime {
    fn start() -> Result<Self> {
        let mut child = Command::new("codex")
            .args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .context("start private Codex runtime")?;
        let input = child.stdin.take().context("missing Codex input")?;
        let output = child.stdout.take().context("missing Codex output")?;
        let (sender, messages) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                let Ok(value) = serde_json::from_str(&line) else {
                    break;
                };
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        let mut runtime = Self {
            child,
            input,
            messages,
            next_id: 0,
        };
        runtime.rpc("initialize", json!({"clientInfo":{"name":"voyager_private_runtime_experiment","version":"0.1"},"capabilities":{"experimentalApi":true}}))?;
        runtime.write(&json!({"method":"initialized"}))?;
        Ok(runtime)
    }

    fn write(&mut self, value: &Value) -> Result<()> {
        serde_json::to_writer(&mut self.input, value)?;
        writeln!(self.input)?;
        self.input.flush()?;
        Ok(())
    }

    fn next(&mut self, timeout: Duration) -> Result<Value> {
        self.messages
            .recv_timeout(timeout)
            .context("private runtime disconnected or exceeded wait bound")
    }

    fn notification(&mut self, value: &Value) -> Result<()> {
        if value.get("id").is_some() && value.get("method").is_some() {
            self.write(&json!({"id":value["id"],"error":{"code":-32601,"message":"Tools and approval requests are outside this experiment"}}))?;
        } else if value.get("method").is_some()
            && !value["method"]
                .as_str()
                .unwrap_or("")
                .starts_with("codex/event/")
        {
            emit(&json!({"event":value["method"],"params":value["params"]}))?;
        }
        Ok(())
    }

    fn rpc(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        self.write(&json!({"id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            ensure!(
                !remaining.is_zero(),
                "{method} timed out; do not automatically retry"
            );
            let value = self.next(remaining)?;
            if value["id"] == id {
                if let Some(error) = value.get("error") {
                    bail!("{method}: {error}");
                }
                return Ok(value["result"].clone());
            }
            self.notification(&value)?;
        }
    }

    fn thread(&mut self, instructions: &str) -> Result<Value> {
        self.rpc("thread/start", json!({"ephemeral":true,"cwd":std::env::current_dir()?,"approvalPolicy":"never","sandbox":"read-only","baseInstructions":instructions}))
    }

    fn reason(&mut self) -> Result<Value> {
        let info = self.thread("You are Voyager's private reasoning runtime. Use only supplied context. Never use tools. Return the requested answer without commentary.")?;
        let id = info["thread"]["id"]
            .as_str()
            .context("missing reasoning thread")?;
        let turn = self.rpc("turn/start", json!({"threadId":id,"effort":"medium","input":[{"type":"text","text":"The harness observed 19 connected Vessels and 23 disconnected Vessels. Return only their total as a decimal integer."}]}))?;
        let turn_id = turn["turn"]["id"].clone();
        let deadline = Instant::now() + Duration::from_secs(90);
        let mut answer = String::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            ensure!(
                !remaining.is_zero(),
                "reasoning exceeded 90 seconds; do not retry"
            );
            let value = self.next(remaining)?;
            if value["params"]["threadId"] == id {
                if value["method"] == "item/completed"
                    && value["params"]["item"]["type"] == "agentMessage"
                {
                    answer.push_str(value["params"]["item"]["text"].as_str().unwrap_or(""));
                }
                if value["method"] == "turn/completed" && value["params"]["turn"]["id"] == turn_id {
                    ensure!(
                        value["params"]["turn"]["status"] == "completed",
                        "reasoning turn failed"
                    );
                    ensure!(
                        answer.trim() == "42",
                        "unexpected reasoning answer: {answer}"
                    );
                    return Ok(
                        json!({"pid":self.child.id(),"thread_id":id,"turn_id":turn_id,"model":info["model"],"answer":answer,"status":"completed","transport":"owned stdio pipes","ephemeral":true}),
                    );
                }
            }
            if value.get("id").is_some() {
                self.notification(&value)?;
            }
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn main() -> Result<()> {
    let proof = std::env::args().any(|argument| argument == "--proof");
    let mut runtime = Runtime::start()?;
    if proof {
        let result = runtime.reason()?;
        let rejection = runtime.rpc("turn/start", json!({"threadId":"not-a-thread","input":[{"type":"text","text":"Must fail before inference"}]})).expect_err("unknown thread must be rejected");
        let pid = runtime.child.id();
        drop(runtime);
        return emit(
            &json!({"proof":"private_reasoning","result":result,"invalid_thread_error":rejection.to_string(),"reaped_pid":pid}),
        );
    }
    let info = runtime.thread("You are Voyager, a concise friendly assistant in the Voyager Electron experiment. This conversation is independent of all terminal agent sessions. Do not claim access to Vessels or tools; this experiment connects only chat and voice. Do not use tools.")?;
    let id = info["thread"]["id"]
        .as_str()
        .context("missing chat thread")?
        .to_owned();
    emit(
        &json!({"event":"ready","params":{"thread_id":id,"pid":runtime.child.id(),"model":info["model"]}}),
    )?;
    let (sender, requests) = mpsc::channel();
    thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let value = serde_json::from_str::<Value>(&line);
            if sender.send(value).is_err() {
                break;
            }
        }
    });
    loop {
        match requests.try_recv() {
            Ok(request) => {
                let request = request?;
                let result = match request["action"].as_str() {
                    Some("chat") => {
                        let text = request["text"].as_str().context("text required")?;
                        ensure!(
                            !text.is_empty() && text.len() <= 8192,
                            "text must be 1..8192 bytes"
                        );
                        runtime.rpc("turn/start", json!({"threadId":id,"effort":"medium","input":[{"type":"text","text":text}]}))
                    }
                    Some("voice-start") => {
                        let sdp = request["sdp"].as_str().context("WebRTC SDP required")?;
                        ensure!(sdp.len() <= 65536, "SDP too large");
                        runtime.rpc("thread/realtime/start", json!({"threadId":id,"outputModality":"audio","transport":{"type":"webrtc","sdp":sdp},"version":"v3","voice":"sol"}))
                    }
                    Some("voice-stop") => {
                        runtime.rpc("thread/realtime/stop", json!({"threadId":id}))
                    }
                    Some("shutdown") => break,
                    _ => bail!("unknown experiment action"),
                };
                match result {
                    Ok(result) => emit(&json!({"id":request["id"],"result":result}))?,
                    Err(error) => emit(&json!({"id":request["id"],"error":error.to_string()}))?,
                }
            }
            Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        match runtime.messages.recv_timeout(Duration::from_millis(5)) {
            Ok(value) => runtime.notification(&value)?,
            Err(mpsc::RecvTimeoutError::Disconnected) => bail!("Codex exited"),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    Ok(())
}
