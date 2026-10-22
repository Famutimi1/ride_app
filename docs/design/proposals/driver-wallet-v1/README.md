# Driver wallet and payout designs

Status: **Approved and implemented across all five screens.**

Generated with built-in image_gen. Full prompts are saved in [prompts.json](prompts.json).

## Proposed screens

1. [Driver wallet](driver-wallet.png): mint available-to-withdraw summary, Withdraw action, compact earnings/payout navigation, friendly ledger labels with signed amounts and balance-after values, expandable activity and support link.
2. [Withdraw earnings](withdraw.png): available balance, selected bank, amount, phone verification, withdrawal amount recap and disabled request action until valid input is complete. Add bank links to the existing bank form.
3. [Add bank account](add-bank.png): compact bank selector opening a searchable picker, 10-digit account number, name resolution, then phone verification and Save. The image depicts a successful name lookup with an empty OTP, so Save remains disabled.
4. [Bank accounts and payouts](payouts.png): saved masked bank accounts, Add bank, Request withdrawal and readable pending/succeeded/failed history states with words and symbols as well as colors.
5. [Earnings breakdown](earnings.png): Today/Week/Month controls, net earnings, gross fares and commission, cash/wallet trip counts, then the existing all-date wallet ledger clearly labeled separately from the range-filtered summary.

## Implementation requirements after approval

- Match rider Payment styling with shared semantic theme tokens and small existing Text variants: labels/helpers 13px, content 15px, compact section labels 14px, balances at most the shared 24px heading size. Utility icons 16–18px, action targets at least 44px. Generated dimensions and shading are visual references; use solid theme fills and shared spacing/radii in code, including dark mode.
- Preserve existing wallet, earnings, payout-account, OTP, withdrawal and Paystack APIs. Driver earnings and rider spending wallets remain separate.
- Preserve positive withdrawable earnings versus cash-commission debt. Show the existing debt warning and Pay now action when owed, including the online-limit restriction; this positive-balance mockup does not show that conditional state.
- Do not show unavailable/loading/error balances as genuine zero. Provide independent retry, empty and stale-data states for wallet/activity, bank lists, earnings summaries and withdrawal history.
- No saved bank: show Add bank guidance on withdrawals and payouts, disable request submission, and avoid sending OTP for an incomplete form. No current bank records were created for the proposal.
- Use live bank list data, filter the picker locally, resolve the selected bank/account before showing the confirmed name, and invalidate that confirmation if either input changes. Preserve server validation and OTP requirements.
- Guard duplicate bank verification, send-code, Save and withdrawal actions. Preserve identity/session checks, validation errors and retry behavior. This proposal does not bypass OTP or submit any financial action.
- Withdrawal states must follow actual API responses. Pending is not paid; failed/reversed outcomes must remain explicit. Do not invent fees, guaranteed payout speeds, automatic payouts, default bank selection features or verification badges. Existing transfer fees must remain governed by the backend; no fee quote is fabricated in these images.
- Ledger credits remain green, debits red, processing states amber, with signs/words/icons. Do not drop transaction types or mutate ledger rows. Preserve actual amounts and kobo precision.
- Wallet View more should reveal compact activity incrementally and then use the existing transaction cursor, as on rider Payment. Payout history currently has no pagination API, so no fake View more is added there.
- Week/Month/Today affects only the earnings summary. Its existing wallet activity endpoint is all dates and must not be presented as filtered unless the API actually supports it. No fabricated charts, daily earnings series, tips, bonuses or goals.
- Wallet/Payout help should navigate to the existing support screen; no external communication is initiated.

## Review and sample data

The live wallet, withdrawal, payouts, add-bank and earnings pages were inspected read-only. No codes were sent, bank information entered, accounts added, withdrawals requested or payments initiated.

Every illustrated name, account identifier, amount and transaction is fictional. ALEX MORGAN and 0000000123 are design placeholders. Wallet activity balances are internally consistent newest-first: commission -1,200 leaves 24,800; the previous +8,000 leaves 26,000; the previous -5,000 leaves 18,000; the previous +7,200 leaves 23,000. The earnings example is gross 30,000 minus commission 6,000 equals net 24,000, across 3 cash plus 5 wallet trips. Available balance is a different metric. The withdrawal form and payout history illustrate separate workflow states, not a simultaneous account snapshot.

These PNGs are approval references, not runtime assets. The user approved all five designs before implementation.


## Implemented screens and validation

The approved pages now use dedicated controllers and shared compact finance components: `DriverFinanceScreens.tsx`, `PayoutForms.tsx`, and `DriverFinanceUI.tsx`. `/account` keeps its approved-driver guard and all existing route names. `WalletSections.tsx` retains the Paystack top-up flow; financial processing and backend policy were not changed.

- Wallet: actual withdrawable balance, existing conditional commission debt/online restriction and Pay now, earnings and payout links, four activity rows initially, View more revealing loaded rows before requesting older cursor pages, and Support navigation.
- Earnings: Today/Week/Month with selected-state accessibility, independent loading/error/retry, server summary, cash and wallet counts, and separately labeled all-date ledger. Previous-range responses cannot replace a newer range.
- Payouts: saved masked accounts, empty/error/retry states, Add bank, Request withdrawal, actual pending/processing/success/failed/reversed states, fee data when returned, refresh and support. Unknown states remain explicit rather than being treated as successful.
- Bank: searchable bank picker with keyboard focus return, 10-digit input, name lookup, then OTP send/resend and Save. Changing bank or account clears confirmation and OTP. No default-bank or deletion functionality was added.
- Withdraw: account selection, exact naira-to-kobo parsing, amount recap, code send/resend, request status/reference after submission, and Payouts tracking. Missing banks, unavailable balances, invalid amounts and incomplete verification block submission. Pending does not mean paid.
- Shared form actions guard repeated taps synchronously and discard late results after session changes or unmount. Read requests also guard late responses; the shared wallet store now ignores older overlapping refreshes.
- Shared naira formatting preserves the minus sign for negative fractional balances, including less than one naira.

### Important difference from the illustrative proposal

The existing backend's `netKobo` is wallet-trip earnings minus cash-trip commission; cash fares were already collected directly by the driver. The UI preserves that value rather than recalculating gross minus commission. A concise caption explains it. The implemented sample shows net 14,000 with gross 30,000, total commission 6,000, and a possible split of wallet gross 20,000 / cash gross 10,000: wallet net 16,000 minus cash commission 2,000. The original generated picture's net 24,000 was illustrative and is not used in the app.

### Verification

- Mobile typecheck, targeted ESLint and diff whitespace checks passed.
- 68 isolated checks with mocked APIs covered precise amounts/limits, financial signs, statuses, duplicate mutation guards, stale reads/range changes, changed sessions, unmounted forms, name verification invalidation, OTP gating, request errors/pending state, paging/deduplication, debt warnings and wallet refresh ordering.
- Browser inspection covered the actual wallet, expandable activity, earnings ranges, empty-bank withdrawal and payouts, Add bank and the live searchable bank list. No account number was entered into the live form.
- Isolated fictional views checked all five designs at 403px and 320px, dark mode, scrolling to form actions, disabled verification states, payout colors/icons, commission debt, balance error/retry, and picker focus return. Light mode and default viewport were restored. Temporary preview route/tab were removed.
- No real verification codes were sent, accounts added, payments initiated, or withdrawals requested. Native Android/iOS keyboard behavior and end-to-end SMS/payment provider flows remain untested.

### Screenshots of the implementation

All screenshots below use fictional fixture data. Their callbacks were inert; API behavior was checked separately with mocks. They show normal mobile viewports; longer screens scroll.

- [Driver wallet](implemented-wallet.png)
- [Withdraw earnings](implemented-withdraw.png)
- [Add bank account after name resolution](implemented-add-bank.png)
- [Bank accounts and payout states](implemented-payouts.png)
- [Earnings breakdown](implemented-earnings.png)


## Visual corrections after comparing all five live pages

The first implementation did not carry over every approved visual detail. The second pass compared each page with its original PNG and corrected the following:

1. **Wallet:** grouped navigation has no extra card padding, activity uses vehicle/wallet/transfer icons, amounts retain their signed colors, summary and footer styling follow the mockup, and outline actions use green labels/borders.
2. **Withdraw:** horizontal balance summary, white silver-bordered amount/OTP fields, left-aligned Add bank action, phone icon on verification, a silver amount recap, and subtle safety/tracking row.
3. **Add bank:** horizontal mint introduction, white outlined fields, green outline actions, circular success confirmation, and divided verification section. The verification section stays visible but disabled before name confirmation; no code or Save action is enabled early.
4. **Payouts:** amounts and status badges now align at the right of each row. Refresh moved into the history heading; support dividers and the processing note match the proposal. Empty bank/history states have their own styled icon cards.
5. **Earnings:** coin summary, divider above net, horizontal cash/wallet statistic tiles, and transaction-specific activity icons. The explanation of the real server net calculation remains concise and accurate.

Typography remains compact, fields and buttons use the shared theme, and only the finance screens use the new controls. Other screens' existing input/button styles were not changed. Balances, ledger values, bank resolution, OTP validation and withdrawal submission logic were preserved.

The corrected live pages were checked individually. Populated payout/bank/withdrawal examples used fictional data and inert callbacks, including right-column wrapping, scrolling, and 320px dark-mode checks. Light mode/default viewport were restored and the temporary route/tab removed. Typecheck, targeted lint, whitespace checks and 70 mocked flow checks passed. No real codes, accounts, payments or withdrawals were submitted.

Current second-pass examples:

- [Populated payouts with fictional records](checked-v2-payouts.png)
- [Confirmed bank form with fictional identity](checked-v2-bank.png)
- [Withdrawal form with fictional balance/account](checked-v2-withdraw.png)
- [Actual bank form before verification, with no private data](checked-v2-bank-empty.png)
- [Actual payout empty states, with no private data](checked-v2-payouts-empty.png)

The earlier implemented screenshots above document the first pass and are retained for comparison.
