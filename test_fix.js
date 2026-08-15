// Self-test for the hardened lib/generate.js — run with: node test_fix.js
const lib = require("./lib/generate.js");
const { validateGpc, injectButtonDefs, buildOfflineScript, sanitizeInputs, buildUserPrompt } = lib;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
}

// ---- Sample 1: the exact broken output captured from the live API (rapid fire only)
const bad1 = `#include <ps5.gph>
// Rapid Fire RPM
int rapid_fire_rpm = 600;
int rapid_fire_cycle_ms = 60000 / rapid_fire_rpm;

main {
    if (get_val(FIRE_BTN)) {
        combo_run(Rapid_Fire);
    } else {
        combo_stop(Rapid_Fire);
    }
}

combo Rapid_Fire {
    set_val(FIRE_BTN, 100);
    wait(rapid_fire_cycle_ms / 2);
    set_val(FIRE_BTN, 0);
    wait(rapid_fire_cycle_ms / 2);
}`;
let e1 = validateGpc(bad1);
console.log("Sample 1 (broken live output) errors:", e1);
check("S1: undefined FIRE_BTN caught", e1.some(x => x.includes("FIRE_BTN")));
check("S1: variable wait() caught", e1.some(x => x.includes("wait")));

// ---- Sample 2: broken output with event_press block + no constants
const bad2 = `#include <xb1.gph>
int anti_recoil_strength = 50;
int strafe_amplitude = 40;
int strafe_direction = 1;
int strafe_counter = 0;

main {
    if (get_val(FIRE_BTN)) {
        set_val(STICK_2_Y, get_val(STICK_2_Y) - (anti_recoil_strength / 100) * 100);
    }
    if (get_val(STICK_1_Y) < -30) {
        set_val(SPRINT_BTN, 100);
    } else {
        set_val(SPRINT_BTN, 0);
    }
    if (get_val(FIRE_BTN)) {
        strafe_counter = strafe_counter + 1;
        if (strafe_counter > 10) {
            strafe_direction = strafe_direction * -1;
            strafe_counter = 0;
        }
        set_val(STICK_1_X, strafe_amplitude * strafe_direction);
    } else {
        set_val(STICK_1_X, 0);
        strafe_counter = 0;
    }
}

combo Quick_Scope {
    set_val(FIRE_BTN, 100);
    wait(100);
    set_val(FIRE_BTN, 0);
}

event_press(ADS_BTN) {
    combo_run(Quick_Scope);
}`;
let e2 = validateGpc(bad2);
console.log("Sample 2 (broken live output) errors:", e2);
check("S2: event_press block caught", e2.some(x => x.includes("top-level block")));
check("S2: undefined FIRE_BTN/SPRINT_BTN caught", e2.some(x => x.includes("FIRE_BTN")) && e2.some(x => x.includes("SPRINT_BTN")));

// ---- Sample 3: broken output with while loops in combos
const bad3 = `#include <xb1.gph>
int rapid_fire_rpm = 700;
int anti_recoil_strength = 50;

main {
    int fire_delay = 60000 / rapid_fire_rpm;
    combo_run(RapidFire);
    combo_run(AntiRecoil);
}

combo RapidFire {
    while (get_val(FIRE_BTN)) {
        set_val(FIRE_BTN, 100);
        wait(fire_delay / 2);
        set_val(FIRE_BTN, 0);
        wait(fire_delay / 2);
    }
    combo_stop(RapidFire);
}

combo AntiRecoil {
    while (true) {
        if (get_val(FIRE_BTN)) {
            set_val(STICK_2_Y, -100 * anti_recoil_strength / 100);
        } else {
            set_val(STICK_2_Y, 0);
        }
        wait(10);
    }
}`;
let e3 = validateGpc(bad3);
console.log("Sample 3 (broken live output) errors:", e3);
check("S3: nested wait in combo caught", e3.some(x => x.includes("only allowed directly inside a combo")));
check("S3: while(true) caught", e3.some(x => x.includes("while(true)")));

// ---- Good script must PASS validation
const good = `#include <ps5.gph>
int FIRE_BTN   = PS4_R2;
int ADS_BTN    = PS4_L2;
int SPRINT_BTN = PS4_L3;
int JUMP_BTN   = PS4_CROSS;
int RAPID_DELAY = 50;
int RECOIL_COMP = 30;

main {
    if (get_val(FIRE_BTN)) {
        combo_run(RAPID_FIRE);
    } else if (combo_running(RAPID_FIRE)) {
        combo_stop(RAPID_FIRE);
    }
    if (get_val(FIRE_BTN) && RECOIL_COMP > 0) {
        set_val(STICK_2_Y, get_val(STICK_2_Y) + RECOIL_COMP);
    }
}

combo RAPID_FIRE {
    set_val(FIRE_BTN, 100);
    wait(50);
    set_val(FIRE_BTN, 0);
    wait(50);
}`;
let eg = validateGpc(good);
console.log("Good script errors:", eg);
check("Good script passes validation", eg.length === 0);

// ---- injection: FIRE_BTN not defined → injected after #include
const inj = injectButtonDefs(bad1.replace("int rapid_fire_rpm = 600;", "// rpm"), { fireBtn: "PS4_R2", adsBtn: "PS4_L2", sprintBtn: "PS4_L3", jumpBtn: "PS4_CROSS", include: "ps5.gph" });
check("injectButtonDefs adds FIRE_BTN", /int FIRE_BTN   = PS4_R2;/.test(inj));
check("injectButtonDefs keeps #include first", inj.indexOf("#include") < inj.indexOf("FIRE_BTN"));
const inj2 = injectButtonDefs(good, { fireBtn: "PS4_R2", adsBtn: "PS4_L2", sprintBtn: "PS4_L3", jumpBtn: "PS4_CROSS" });
check("injectButtonDefs no-ops when defined", inj2 === good);

// ---- offline engine: must build valid GPC for every mod combo
const p = sanitizeInputs({
  game: "Arena FPS", platform: "PlayStation 5", include: "ps5.gph", style: "Hybrid (Balanced)", styleKey: "hybrid",
  fireBtn: "PS4_R2", adsBtn: "PS4_L2", sprintBtn: "PS4_L3", jumpBtn: "PS4_CROSS", rpm: 600, recoil: 30,
  mods: { rapid: true, recoil: true, quick: true, auto: true, strafe: true, aim: true, aimbot: true, polar: true, size: true, correction: true },
  notes: ""
});
const off = buildOfflineScript(p);
const eoff = validateGpc(off.code);
console.log("Offline all-mods errors:", eoff);
check("Offline all-mods passes validation", eoff.length === 0, JSON.stringify(eoff));
check("Offline has #include", off.code.includes("#include <ps5.gph>"));
check("Offline has 4 button defs", ["FIRE_BTN","ADS_BTN","SPRINT_BTN","JUMP_BTN"].every(n => new RegExp("int " + n + "\\s*=").test(off.code)));
check("Offline name/fp set", /^zen_/.test(off.name) && /^ZS-/.test(off.fp));

// ---- user prompt sanity (no raw undefined patterns)
const up = buildUserPrompt(p, ["wait() takes only an integer constant"]);
check("buildUserPrompt contains literal half-cycle delay", up.includes("wait(50)"));
check("buildUserPrompt contains button defs", up.includes("int FIRE_BTN   = PS4_R2;"));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
