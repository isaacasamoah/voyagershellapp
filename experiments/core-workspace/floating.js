const api = window.voyager;
const $ = (id) => document.getElementById(id);
function notify(text) {
  $("chat-state").textContent = String(text);
}
const call = (method, input) => api.call(method, input);
let token;
$("avatar").onclick = () => call("restore").catch(notify);
$("avatar").ondragstart = (event) => {
  token = crypto.randomUUID();
  event.dataTransfer.setData("application/x-voyager-avatar", token);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setDragImage($("voyager-avatar"), 47, 47);
  call("avatar-drag", { token }).catch(notify);
};
$("avatar").ondragend = () => call("avatar-drop", { token }).catch(notify);
api.on("avatar-state", (state) => {
  $("avatar").title =
    `${state.focus.label}. Click to open workspace. Pull to move or dock.`;
});
call("avatar-ready").catch(notify);
