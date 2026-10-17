# Rakky Ride email templates

Open **index.html** in a browser to review the HTML designs. Choose a design in the sidebar and switch between Desktop and Mobile previews. Use **Open HTML design** to see the complete email by itself. Plain-text fallback is the alternate version used by mail clients that cannot show HTML.

## Folder contents

- index.html — visual review gallery.
- *.html — readable HTML review copies: welcomes, admin signup alerts, application receipt, approval, rejection, mixed decisions, suspension, account updates and delivery test.
- *.txt — matching plain-text alternatives.
- assets/rakky-ride-logo.png — unchanged canonical brand logo, shared by all previews.

## Changing emails that the app sends

1. Edit text, layout, buttons or logo placement in **../backend/src/modules/notifications/emailTemplates.ts**.
2. Colors come from **../mobile/src/constants/colors.ts**. After changing that palette, run **npm run sync:email-brand** from backend.
3. Run **npm run preview:emails** from backend to regenerate this folder, then review index.html again.
4. Run **npm run typecheck** from backend and restart/rebuild the backend when deploying changed templates.

You can edit the HTML files here to try a design or annotate a proposed change. Those local edits are review drafts: they do not change live emails, and regenerating the library replaces them. Copy an edited draft to a different filename before regenerating, or ask for its changes to be incorporated into the live template source.

## Links and sending

This gallery works offline and uses the canonical local PNG. Preview buttons use example.test fixture URLs. Production customer buttons use the dashboard's public **/open-app** page, which launches the installed native app. Set **EMAIL_DASHBOARD_URL** in **../backend/.env**; a separate EMAIL_APP_URL is no longer required. The field guide is **../backend/.env.example**. Optional published store links are configured in the separate dashboard's .env.example. No credentials are stored here and opening a preview never sends an email.

See **../docs/features/email-system.md** for configuration and recovery instructions.
