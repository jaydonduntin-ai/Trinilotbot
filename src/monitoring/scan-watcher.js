export async function startScanWatcher() {
  // Live target delivery is intentionally disabled. Candidate discovery and
  // persistence continue in target-scanner.js, while /target performs fresh
  // presence/public-server verification only when the command is invoked.
  console.info(
    "Automatic target feed disabled; background candidate pool + on-demand /target active.",
  );
}
