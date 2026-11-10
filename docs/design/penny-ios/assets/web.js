// Shared desktop chrome for the web cards: <div class="browser" data-url="..." data-active="home">…<main class="wmain">…</main></div>
const WEB_NAV = [
  { items: [["home", "home", "Home", "G H"], ["activity", "list", "Activity", "G A"], ["insights", "pie-chart", "Insights", "G I"]] },
  { h: "Together", items: [["apartment", "people", "Apartment", "", "$142"], ["lisbon", "airplane", "Lisbon", "", "Nov 12"], ["trips", "airplane", "All trips", ""]] },
  { h: "Manage", items: [["recurring", "repeat", "Recurring", "", "6"], ["accounts", "wallet", "Accounts", ""], ["categories", "pricetag", "Categories", ""]] },
];
function webChrome() {
  document.querySelectorAll(".browser").forEach((b) => {
    const active = b.dataset.active, url = b.dataset.url || "penny.example.com";
    const main = b.querySelector(".wmain");
    const side = b.dataset.noside === undefined ? `<aside class="wside">
      <div class="wbrand"><span class="logo"><i data-i="leaf"></i></span>penny.</div>
      ${WEB_NAV.map((s) => `${s.h ? `<div class="wh">${s.h}</div>` : ""}${s.items.map(([k, ic, l, kb, n]) =>
        `<div class="wnav${k === active ? " on" : ""}"><i data-i="${ic}"></i>${l}${n ? `<span class="n">${n}</span>` : kb ? `<kbd>${kb}</kbd>` : ""}</div>`).join("")}`).join("")}
      <div class="wfoot"><div class="avatar" style="width:32px;height:32px;border:0;font-size:12px">MF</div>
        <div><b>Max Falicoff</b><span><i data-i="cloud-done" style="width:13px;height:13px"></i>Synced just now</span></div>
        <i data-i="settings" style="margin-left:auto;color:var(--label-2);width:18px;height:18px"></i></div>
    </aside>` : "";
    const page = document.createElement("div"); page.className = "page";
    page.innerHTML = side; page.appendChild(main);
    b.insertAdjacentHTML("afterbegin", `<div class="chrome"><span class="lights"><i></i><i></i><i></i></span>
      <span class="url"><i data-i="lock-closed"></i>${url}</span><span style="width:52px"></span></div>`);
    b.insertBefore(page, b.children[1]);
  });
}
document.addEventListener("DOMContentLoaded", () => { webChrome(); drawIcons(); });
