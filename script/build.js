import { execSync } from 'child_process';
import { rmSync, renameSync } from "fs";

const exec = (cmd) => {
    execSync(cmd, { stdio: 'inherit' });
}

rmSync("./dist", { "recursive": true, force: true });

exec("npx tsc")
renameSync("dist/index.js", "dist/index.mjs")
