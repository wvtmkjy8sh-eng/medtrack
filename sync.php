<?php
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
$dir = __DIR__ . DIRECTORY_SEPARATOR . "data";
if (!is_dir($dir)) {
  mkdir($dir, 0777, true);
}
$stateFile = $dir . DIRECTORY_SEPARATOR . "push-state.json";
$vapidFile = $dir . DIRECTORY_SEPARATOR . "vapid.json";

function read_json($file, $fallback) {
  if (!is_file($file)) return $fallback;
  $data = json_decode(file_get_contents($file), true);
  return is_array($data) ? $data : $fallback;
}

if (isset($_GET["vapid"])) {
  $vapid = read_json($vapidFile, []);
  echo json_encode(["publicKey" => $vapid["publicKey"] ?? ""]);
  exit;
}

if ($_SERVER["REQUEST_METHOD"] === "GET") {
  echo json_encode(read_json($stateFile, ["subscriptions" => [], "doses" => [], "taken" => []]));
  exit;
}

$incoming = json_decode(file_get_contents("php://input"), true);
if (!is_array($incoming)) {
  http_response_code(400);
  echo json_encode(["ok" => false]);
  exit;
}

$current = read_json($stateFile, []);
$subs = isset($current["subscriptions"]) && is_array($current["subscriptions"]) ? $current["subscriptions"] : [];
if (!empty($incoming["subscription"]["endpoint"])) {
  $subs = array_values(array_filter($subs, function ($s) use ($incoming) {
    return ($s["endpoint"] ?? "") !== $incoming["subscription"]["endpoint"];
  }));
  $subs[] = $incoming["subscription"];
}
if (isset($incoming["subscriptions"]) && is_array($incoming["subscriptions"])) {
  $subs = $incoming["subscriptions"];
}

$state = [
  "updatedAt" => date("c"),
  "updatedAtMs" => isset($incoming["updatedAtMs"]) ? intval($incoming["updatedAtMs"]) : (int) round(microtime(true) * 1000),
  "subscriptions" => $subs,
  "doses" => isset($incoming["doses"]) && is_array($incoming["doses"]) ? $incoming["doses"] : ($current["doses"] ?? []),
  "taken" => isset($incoming["taken"]) && is_array($incoming["taken"]) ? $incoming["taken"] : ($current["taken"] ?? []),
  "meds" => isset($incoming["meds"]) && is_array($incoming["meds"]) ? $incoming["meds"] : ($current["meds"] ?? []),
  "history" => isset($incoming["history"]) && is_array($incoming["history"]) ? $incoming["history"] : ($current["history"] ?? []),
  "settings" => isset($incoming["settings"]) && is_array($incoming["settings"]) ? $incoming["settings"] : ($current["settings"] ?? []),
  "reminderMode" => $incoming["reminderMode"] ?? ($current["reminderMode"] ?? "notification"),
];
file_put_contents($stateFile, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
echo json_encode(["ok" => true, "subscriptions" => count($subs)]);
