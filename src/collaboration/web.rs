use super::db::Db;
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};
use tiny_http::{Header, Response, Server};

pub fn start(path: PathBuf, status: Arc<Mutex<Value>>) -> Result<String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| anyhow::anyhow!("inspector bind: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .context("missing inspector address")?
        .port();
    let token = uuid::Uuid::new_v4().to_string();
    let root = format!("/{token}/");
    let url = format!("http://127.0.0.1:{port}{root}");
    thread::Builder::new().name("collaboration-inspector".into()).spawn(move || {
        for request in server.incoming_requests() {
            let host=request.headers().iter().find(|h|h.field.equiv("Host")).map(|h|h.value.as_str());
            let valid=host==Some(format!("127.0.0.1:{port}").as_str()) && request.method().as_str()=="GET";
            let (code,content,kind)=if !valid {(403,"Forbidden".into(),"text/plain")}
            else if request.url()==root {(200,include_str!("inspector.html").into(),"text/html; charset=utf-8")}
            else if request.url()==format!("{root}api/state") {
                let result=(||->Result<Value>{
                    let db=Db(rusqlite::Connection::open_with_flags(&path,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?);
                    db.0.busy_timeout(std::time::Duration::from_secs(2))?;
                    let mut snapshot=db.snapshot()?;
                    snapshot["worker"]=status.lock().unwrap().clone();
                    Ok(snapshot)
                })();
                match result {Ok(v)=>(200,v.to_string(),"application/json"),Err(e)=>(500,json!({"error":e.to_string()}).to_string(),"application/json")}
            } else {(404,"Not found".into(),"text/plain")};
            let mut response=Response::from_string(content).with_status_code(code);
            for (name,value) in [("Content-Type",kind),("Cache-Control","no-store"),("X-Content-Type-Options","nosniff"),("Referrer-Policy","no-referrer"),("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")] {
                response.add_header(Header::from_bytes(name,value).unwrap());
            }
            let _=request.respond(response);
        }
    })?;
    Ok(url)
}
