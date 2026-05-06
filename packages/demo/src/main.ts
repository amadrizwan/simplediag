import { renderFromSource, type Diagnostic } from "simplediag";

const sample = `nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    web01 [address = "10.0.0.10", shape = cloud];
    web02 [address = "10.0.0.11"];
  }
  network internal {
    address = "10.1.0.0/24";
    web01 [address = "10.1.0.10"];
    db01 [address = "10.1.0.20", shape = database];
    cache [shape = queue];
  }
  group app {
    description = "Application tier";
    web01;
    web02;
  }
  web01 -- db01;
}
`;

const initialTab = new URLSearchParams(location.search).get("tab") ?? "svg";
const sourceEl = document.getElementById("source") as HTMLTextAreaElement;
const renderBtn = document.getElementById("render") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const errorModeEl = document.getElementById("errorMode") as HTMLInputElement;
const svgPane = document.getElementById("svgPane") as HTMLDivElement;
const diagPane = document.getElementById("diagPane") as HTMLPreElement;
const rawPane = document.getElementById("rawPane") as HTMLPreElement;
const diagCount = document.getElementById("diagCount") as HTMLSpanElement;
const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
const panes = document.querySelectorAll<HTMLElement>(".pane");

const querySource = new URLSearchParams(location.search).get("source");
sourceEl.value = querySource ?? sample;

function render() {
  const source = sourceEl.value;
  const result = renderFromSource(source, {
    id: "diagram",
    errorMode: errorModeEl.checked ? "svg" : "null"
  });

  if (result.svg) {
    svgPane.innerHTML = result.svg;
    rawPane.textContent = result.svg;
  } else {
    svgPane.innerHTML = '<p style="color:#5f6b75;font-size:13px;">No SVG produced. Check Diagnostics.</p>';
    rawPane.textContent = "(no svg)";
  }

  renderDiagnostics(result.diagnostics);
}

function renderDiagnostics(diagnostics: Diagnostic[]): void {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  diagCount.textContent = String(diagnostics.length);
  diagCount.classList.remove("has-errors", "has-warnings");
  if (errors > 0) diagCount.classList.add("has-errors");
  else if (warnings > 0) diagCount.classList.add("has-warnings");

  if (diagnostics.length === 0) {
    diagPane.textContent = "No diagnostics.";
    return;
  }

  diagPane.innerHTML = "";
  for (const d of diagnostics) {
    const row = document.createElement("div");
    row.className = "diag";
    const sev = document.createElement("div");
    sev.className = `diag-severity ${d.severity}`;
    sev.textContent = d.severity;
    const body = document.createElement("div");
    const code = document.createElement("div");
    code.textContent = `${d.code}: ${d.message}`;
    body.appendChild(code);
    if (d.loc) {
      const loc = document.createElement("div");
      loc.className = "diag-loc";
      loc.textContent = `line ${d.loc.start.line}, col ${d.loc.start.column}`;
      body.appendChild(loc);
    }
    row.appendChild(sev);
    row.appendChild(body);
    diagPane.appendChild(row);
  }
}

function activateTab(name: string): void {
  for (const tab of tabs) tab.classList.toggle("active", tab.dataset.tab === name);
  for (const pane of panes) pane.classList.toggle("hidden", pane.dataset.pane !== name);
}

for (const tab of tabs) {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab ?? "svg"));
}

renderBtn.addEventListener("click", render);
if (initialTab !== "svg") activateTab(initialTab);
clearBtn.addEventListener("click", () => {
  sourceEl.value = "";
  svgPane.innerHTML = "";
  rawPane.textContent = "";
  diagPane.textContent = "No diagnostics.";
  diagCount.textContent = "";
  diagCount.classList.remove("has-errors", "has-warnings");
});
sourceEl.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    render();
  }
});

render();
