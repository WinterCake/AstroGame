import { execSync } from "node:child_process";

const port = Number(process.env.ASTROGAME_UI_PORT) || 3847;

function killPortWindows() {
  const cmd = [
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    "| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
  ].join(" ");
  execSync(`powershell -NoProfile -Command "${cmd}"`, { stdio: "ignore" });
}

function killPortUnix() {
  execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore", shell: true });
}

try {
  if (process.platform === "win32") killPortWindows();
  else killPortUnix();
} catch {
  /* rien n'écoutait sur ce port */
}
