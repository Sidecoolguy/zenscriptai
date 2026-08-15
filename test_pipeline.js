// Tests the handleGenerate pipeline (retry + offline fallback) with a mocked LLM.
const lib = require("./lib/generate.js");
const { handleGenerate } = lib;

// Mock responses the "LLM" returns on each call.
const BROKEN = `#include <ps5.gph>
main {
    if (get_val(FIRE_BTN)) {
        combo_run(RapidFire);
    }
    event_press(ADS_BTN) {
        combo_run(Quick);
    }
}
combo RapidFire {
    set_val(FIRE_BTN, 100);
    wait(fire_delay / 2);
}`;
const GOOD = `#include <ps5.gph>
int FIRE_BTN   = PS4_R2;
int ADS_BTN    = PS4_L2;
int SPRINT_BTN = PS4_L3;
int JUMP_BTN   = PS4_CROSS;
int RECOIL_COMP = 30;

main {
    if (get_val(FIRE_BTN) && RECOIL_COMP > 0) {
        set_val(STICK_2_Y, get_val(STICK_2_Y) + RECOIL_COMP);
    }
}`;

const payload = {
  game: "Arena FPS", platform: "PlayStation 5", include: "ps5.gph",
  style: "Recoil Control Master", styleKey: "recoil",
  fireBtn: "PS4_R2", adsBtn: "PS4_L2", sprintBtn: "PS4_L3", jumpBtn: "PS4_CROSS",
  rpm: 600, recoil: 30,
  mods: { rapid: false, recoil: true, quick: false, auto: false, strafe: false, aim: false, aimbot: false, polar: false, size: false, correction: false },
  notes: ""
};

function mockFetch(sequence) {
  let call = 0;
  return async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: sequence[Math.min(call++, sequence.length - 1)] } }]
    })
  });
}

(async () => {
  // Case 1: broken first, good second → success after retry, model = real model
  global.fetch = mockFetch([BROKEN, GOOD]);
  process.env.LLM_API_KEY = "test";
  const r1 = await handleGenerate(payload);
  console.log("Case 1 (retry succeeds): ok=" + r1.json.ok, "| model=" + r1.json.model, "| fallback=" + r1.json.fallback);
  const v1 = lib.validateGpc(r1.json.code);
  console.log("  validation errors:", v1);
  console.log(r1.json.ok === true && v1.length === 0 && r1.json.fallback !== true ? "  PASS\n" : "  FAIL\n");

  // Case 2: always broken → offline fallback, still ok:true with valid GPC
  global.fetch = mockFetch([BROKEN]);
  const r2 = await handleGenerate(payload);
  console.log("Case 2 (always broken): ok=" + r2.json.ok, "| model=" + r2.json.model, "| fallback=" + r2.json.fallback);
  const v2 = lib.validateGpc(r2.json.code);
  console.log("  validation errors:", v2);
  console.log(r2.json.ok === true && r2.json.fallback === true && v2.length === 0 ? "  PASS\n" : "  FAIL\n");

  // Case 3: offline script output shown
  console.log("=== Sample offline fallback script (recoil only) ===");
  console.log(r2.json.code.split("\n").slice(0, 30).join("\n"));
  console.log("...");
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
