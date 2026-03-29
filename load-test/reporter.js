const chalk = require("chalk");

function reportScenario(name, httpResults) {
  const total = httpResults.length;
  const by201 = httpResults.filter((r) => r.status === 201).length;
  const by409 = httpResults.filter((r) => r.status === 409).length;
  const by503 = httpResults.filter((r) => r.status === 503).length;
  const errors = httpResults.filter((r) => r.error).length;
  const other = total - by201 - by409 - by503 - errors;

  const durations = httpResults.filter((r) => r.durationMs).map((r) => r.durationMs);
  const maxMs = durations.length ? Math.max(...durations) : 0;
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  console.log(chalk.bold(`\n── ${name} ──`));
  console.log(`   Requests : ${total}`);
  console.log(`   201 OK   : ${chalk.green(by201)}`);
  if (by409) console.log(`   409 Conflict : ${chalk.yellow(by409)}`);
  if (by503) console.log(`   503 Unavail  : ${chalk.yellow(by503)}`);
  if (other) console.log(`   Other    : ${chalk.dim(other)}`);
  if (errors) console.log(`   Errors   : ${chalk.red(errors)}`);
  console.log(`   Latency  : avg ${avgMs}ms / max ${maxMs}ms`);
}

function reportVerification(checks) {
  console.log(chalk.bold("   Invariants:"));
  for (const { name, result } of checks) {
    const icon = result.pass ? chalk.green("✔") : chalk.red("✗");
    const label = result.pass ? chalk.green(name) : chalk.red(name);
    console.log(`     ${icon} ${label}`);
    if (!result.pass) {
      console.log(`       ${chalk.dim(result.detail)}`);
    }
  }
}

function reportError(name, err) {
  console.log(chalk.bold.red(`\n── ${name} — ERROR ──`));
  console.log(chalk.red(`   ${err.message}`));
  if (err.stack) console.log(chalk.dim(err.stack.split("\n").slice(1).join("\n")));
}

function reportSummary(allResults) {
  console.log(chalk.bold("\n══════════════════════════════════════"));
  console.log(chalk.bold("  LOAD TEST SUMMARY"));
  console.log(chalk.bold("══════════════════════════════════════"));

  const colWidth = 34;
  for (const r of allResults) {
    const statusStr = r.passed
      ? chalk.green("PASS")
      : r.error
      ? chalk.red("ERROR")
      : chalk.red("FAIL");
    const name = r.name.padEnd(colWidth);
    const duration = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "";
    console.log(`  ${statusStr}  ${name} ${chalk.dim(duration)}`);
  }

  const totalPassed = allResults.filter((r) => r.passed).length;
  const total = allResults.length;
  const allGood = totalPassed === total;

  console.log(chalk.bold("══════════════════════════════════════"));
  if (allGood) {
    console.log(chalk.bold.green(`  All ${total} scenarios passed ✔`));
  } else {
    console.log(chalk.bold.red(`  ${totalPassed}/${total} scenarios passed`));
  }
  console.log(chalk.bold("══════════════════════════════════════\n"));
}

module.exports = { reportScenario, reportVerification, reportError, reportSummary };
