/**
 * tests — a 60-line test runner. No dependencies, by project rule.
 * Usage:  import { test, assert, run } from "./tiny.js";
 */
const tests = [];
let suiteName = "";

export function suite(name) { suiteName = name; }

export function test(name, fn) { tests.push({ name, fn, suite: suiteName }); }

export const assert = {
    ok(cond, msg = "expected truthy") {
        if (!cond) throw new Error(msg);
    },
    not(cond, msg = "expected falsy") {
        if (cond) throw new Error(msg);
    },
    eq(a, b, msg) {
        if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    },
    near(a, b, eps = 1e-6, msg) {
        if (Math.abs(a - b) > eps) throw new Error(msg || `expected ~${b}, got ${a}`);
    },
    gt(a, b, msg) {
        if (!(a > b)) throw new Error(msg || `expected ${a} > ${b}`);
    },
    gte(a, b, msg) {
        if (!(a >= b)) throw new Error(msg || `expected ${a} >= ${b}`);
    },
    lt(a, b, msg) {
        if (!(a < b)) throw new Error(msg || `expected ${a} < ${b}`);
    },
    lte(a, b, msg) {
        if (!(a <= b)) throw new Error(msg || `expected ${a} <= ${b}`);
    },
    deep(a, b, msg) {
        const x = JSON.stringify(a), y = JSON.stringify(b);
        if (x !== y) throw new Error(msg || `expected ${y}, got ${x}`);
    },
    throws(fn, msg = "expected a throw") {
        let threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error(msg);
    }
};

export async function run(label = "tests") {
    let passed = 0;
    const failures = [];
    for (const t of tests) {
        try {
            await t.fn();
            passed++;
        } catch (err) {
            failures.push({ name: `${t.suite ? t.suite + " › " : ""}${t.name}`, err });
        }
    }
    const total = tests.length;
    if (failures.length) {
        console.error(`\n❌ ${label}: ${failures.length} из ${total} тестов упали\n`);
        for (const f of failures) console.error(`   • ${f.name}\n     ${f.err.message}`);
        process.exitCode = 1;
    } else {
        console.log(`✅ ${label}: ${passed}/${total} тестов зелёные`);
    }
    return { passed, total, failures };
}
