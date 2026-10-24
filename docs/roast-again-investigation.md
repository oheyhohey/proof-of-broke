# Production Roast Again investigation

Observed on 2026-10-24 against main `8c415126297ac7891dc54e78b5745d0a974077ad`.

## Reported failure

After successful analysis, one Roast Again interaction produces a second
`POST /api/balance` (200, 258 ms, initiator `index-B9oKBO8V.js:9`). The result
disappears and returns with the initial roast. The captured submitter was
**Roast my wallet**, while Roast Again had `type === 'submit'` and `form === null`.

This establishes an extra analysis request in the affected session. The initiator
line alone does not identify its caller: much of the minified application is on
that line.

## Deployed code comparison

The production HTML references `/assets/index-B9oKBO8V.js`. Its downloaded contents
and the JavaScript built from main are byte-for-byte identical (SHA-256):

```
4c6c77401ea3cab84a34b5b14f10776c5e376e4250f8815e7d9a31364d7269d5
```

The local main build named those same JavaScript bytes `index-DOmta6g0.js`.
Asset names alone are not a reliable content comparison.

In the deployed bundle, Roast Again calls `q(zl => zl + 1)` (the offset setter)
and `Tl("")` (the notice setter). The analyzer form calls the separate `rl`
function. That function prevents document submission, clears the result, resets
offset to zero, and calls the balance fetcher. An unchanged balance therefore
recreates the initial roast and score when analysis runs again.

The result actions are siblings of the analyzer section, outside its form.
No application ancestor click handler forwards their clicks to the form.
A button with no explicit type reports `type === 'submit'`, but without a form
owner it cannot submit that unrelated form through its native default action.
The reported **Roast my wallet** submitter therefore needs an activation trace;
the missing type alone does not explain it.

## Direct production verification

Using clean Chromium with a real successful production balance response:

- The captured pointerdown, pointerup, and click targets were Roast Again.
- No submit event occurred, no navigation occurred, and only the initial balance
  request occurred.
- The displayed roast changed.
- React commit instrumentation observed offset `0 → 1`, a populated result
  throughout the interaction, and loading remaining false.
- The original result section remained connected and was the same DOM node.

The command sandbox initially could not connect to `proxy:8080`; running the
approved read-only requests and Chromium outside that sandbox resolved access.

## Regression coverage and limits

`tests/proxy-browser.test.ts` adds desktop pointer and mobile touch cases that:

1. Complete successful analysis through the HTTP proxy fixture.
2. Start a fresh request/event log and refocus the wallet input.
3. Perform exactly one real Roast Again interaction.
4. Observe a further 600 ms, covering the reported 258 ms response duration.
5. Require no request, submission, navigation, or section removal; exactly one
   Roast Again click; changed roast; unchanged wallet, timestamp, balance, and score.

These tests also pass against unchanged main. They are regression coverage, not
evidence that the session-specific cause has been repaired. Existing full-cycle,
PNG download, X share text, score, and 120-message coverage remains in place.
In a temporary scratch build, replacing the offset handler with
`form.requestSubmit(analyzeButton)` makes both new cases fail specifically on
the unexpected `/api/balance` request. That deliberate mutation is not in the PR.

PR #4 retains explicit non-submit button types as defensive hardening. Further
application changes require a trace identifying what activates the analyzer in
the affected Chrome session. In Chrome DevTools, enable Preserve log and run:

```js
monitorEvents(document, ['pointerdown', 'pointerup', 'click', 'keydown', 'submit'])
```

Click Roast Again once and inspect the targets, key values, and submitter. Stop
logging with `unmonitorEvents(document)`. If a click on Roast Again is followed by
another activation or submission, use Sources → Event Listener Breakpoints for
`click` and `submit` to inspect the call stack that connects them. No merge or
deployment is part of this investigation.
