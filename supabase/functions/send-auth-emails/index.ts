import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';

// Brevo HTTP API for Apple/iCloud — Supabase Edge Functions block SMTP ports 25/465/587.
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const BREVO_FROM = Deno.env.get('BREVO_FROM') ?? Deno.env.get('SMTP_FROM') ?? SENDER_EMAIL;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Arabic recovery template (base64 UTF-8) — see supabase/email-templates/athar-recovery-simple.html
const HTML_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImFyIiBkaXI9InJ0bCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGh0bWwiPgo8aGVhZD4KICA8bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CiAgPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgogIDxtZXRhIG5hbWU9ImNvbG9yLXNjaGVtZSIgY29udGVudD0ibGlnaHQgb25seSI+CiAgPG1ldGEgbmFtZT0ic3VwcG9ydGVkLWNvbG9yLXNjaGVtZXMiIGNvbnRlbnQ9ImxpZ2h0Ij4KICA8c3R5bGU+CiAgICA6cm9vdCB7IGNvbG9yLXNjaGVtZTogbGlnaHQgb25seTsgc3VwcG9ydGVkLWNvbG9yLXNjaGVtZXM6IGxpZ2h0OyB9CiAgICBib2R5LCB0YWJsZSwgdGQsIHAsIGRpdiwgc3BhbiwgYSB7IGNvbG9yLXNjaGVtZTogbGlnaHQgb25seTsgfQogICAgLmF0aGFyLW91dGVyIHsgYmFja2dyb3VuZC1jb2xvcjogI2Y1ZjVmNSAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2Y1ZjVmNSwgI2Y1ZjVmNSkgIWltcG9ydGFudDsgfQogICAgLmF0aGFyLWNhcmQgeyBiYWNrZ3JvdW5kLWNvbG9yOiAjZmZmZmZmICFpbXBvcnRhbnQ7IGJhY2tncm91bmQtaW1hZ2U6IGxpbmVhci1ncmFkaWVudCgjZmZmZmZmLCAjZmZmZmZmKSAhaW1wb3J0YW50OyB9CiAgICAuYXRoYXItYnJhbmQsIC5hdGhhci10aXRsZSwgLmF0aGFyLWxpbmsgeyBjb2xvcjogIzE4MTgxYiAhaW1wb3J0YW50OyB9CiAgICAuYXRoYXItYm9keSB7IGNvbG9yOiAjM2YzZjQ2ICFpbXBvcnRhbnQ7IH0KICAgIC5hdGhhci1tdXRlZCB7IGNvbG9yOiAjNzE3MTdhICFpbXBvcnRhbnQ7IH0KICAgIC5hdGhhci10b2tlbiB7IGJhY2tncm91bmQtY29sb3I6ICNmYWZhZmEgIWltcG9ydGFudDsgYmFja2dyb3VuZC1pbWFnZTogbGluZWFyLWdyYWRpZW50KCNmYWZhZmEsICNmYWZhZmEpICFpbXBvcnRhbnQ7IGNvbG9yOiAjMTgxODFiICFpbXBvcnRhbnQ7IH0KICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHsKICAgICAgLmF0aGFyLW91dGVyIHsgYmFja2dyb3VuZC1jb2xvcjogI2Y1ZjVmNSAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2Y1ZjVmNSwgI2Y1ZjVmNSkgIWltcG9ydGFudDsgfQogICAgICAuYXRoYXItY2FyZCB7IGJhY2tncm91bmQtY29sb3I6ICNmZmZmZmYgIWltcG9ydGFudDsgYmFja2dyb3VuZC1pbWFnZTogbGluZWFyLWdyYWRpZW50KCNmZmZmZmYsICNmZmZmZmYpICFpbXBvcnRhbnQ7IH0KICAgICAgLmF0aGFyLWJyYW5kLCAuYXRoYXItdGl0bGUsIC5hdGhhci1saW5rIHsgY29sb3I6ICMxODE4MWIgIWltcG9ydGFudDsgfQogICAgICAuYXRoYXItYm9keSB7IGNvbG9yOiAjM2YzZjQ2ICFpbXBvcnRhbnQ7IH0KICAgICAgLmF0aGFyLW11dGVkIHsgY29sb3I6ICM3MTcxN2EgIWltcG9ydGFudDsgfQogICAgICAuYXRoYXItdG9rZW4geyBiYWNrZ3JvdW5kLWNvbG9yOiAjZmFmYWZhICFpbXBvcnRhbnQ7IGNvbG9yOiAjMTgxODFiICFpbXBvcnRhbnQ7IH0KICAgIH0KICAgIHUgKyAuYm9keSAuYXRoYXItb3V0ZXIgeyBiYWNrZ3JvdW5kLWNvbG9yOiAjZjVmNWY1ICFwb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2Y1ZjVmNSwgI2Y1ZjVmNSkgIWltcG9ydGFudDsgfQogICAgdSArIC5ib2R5IC5hdGhhci1jYXJkIHsgYmFja2dyb3VuZC1jb2xvcjogI2ZmZmZmZiAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2ZmZmZmZiwjZmZmZmZmKSAhaW1wb3J0YW50OyB9CiAgICB1ICsgLmJvZHkgLmF0aGFyLWJyYW5kLCB1ICsgLmJvZHkgLmF0aGFyLXRpdGxlLCB1ICsgLmJvZHkgLmF0aGFyLWxpbmsgeyBjb2xvcjogIzE4MTgxYiAhaW1wb3J0YW50OyB9CiAgICB1ICsgLmJvZHkgLmF0aGFyLWJvZHkgeyBjb2xvcjogIzNmM2Y0NiAhaW1wb3J0YW50OyB9CiAgICB1ICsgLmJvZHkgLmF0aGFyLW11dGVkIHsgY29sb3I6ICM3MTcxN2EgIWltcG9ydGFudDsgfQogICAgdSArIC5ib2R5IC5hdGhhci10b2tlbiB7IGJhY2tncm91bmQtY29sb3I6ICNmYWZhZmEgIWltcG9ydGFudDsgY29sb3I6ICMxODE4MWIgIWltcG9ydGFudDsgfQogICAgW2RhdGEtb2dzY10gLmF0aGFyLW91dGVyIHsgYmFja2dyb3VuZC1jb2xvcjogI2Y1ZjVmNSAhaW1wb3J0YW50OyB9CiAgICBbZGF0YS1vZ3NjXSAuYXRoYXItY2FyZCB7IGJhY2tncm91bmQtY29sb3I6ICNmZmZmZmYgIWltcG9ydGFudDsgfQogICAgW2RhdGEtb2dzY10gLmF0aGFyLWJyYW5kLCBbZGF0YS1vZ3NjXSAuYXRoYXItdGl0bGUsIFtkYXRhLW9nc2NdIC5hdGhhci1saW5rIHsgY29sb3I6ICMxODE4MWIgIWltcG9ydGFudDsgfQogICAgW2RhdGEtb2dzY10gLmF0aGFyLWJvZHkgeyBjb2xvcjogIzNmM2Y0NiAhaW1wb3J0YW50OyB9CiAgICBbZGF0YS1vZ3NjXSAuYXRoYXItbXV0ZWQgeyBjb2xvcjogIzcxNzE3YSAhaW1wb3J0YW50OyB9CiAgICBbZGF0YS1vZ3NjXSAuYXRoYXItdG9rZW4geyBiYWNrZ3JvdW5kLWNvbG9yOiAjZmFmYWZhICFpbXBvcnRhbnQ7IGNvbG9yOiAjMTgxODFiICFpbXBvcnRhbnQ7IH0KICA8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5IGNsYXNzPSJib2R5IiBzdHlsZT0ibWFyZ2luOjA7cGFkZGluZzowO2JhY2tncm91bmQtY29sb3I6I2Y1ZjVmNTsiPgo8dGFibGUgcm9sZT0icHJlc2VudGF0aW9uIiBjbGFzcz0iYXRoYXItb3V0ZXIiIHdpZHRoPSIxMDAlIiBjZWxsc3BhY2luZz0iMCIgY2VsbHBhZGRpbmc9IjAiIGJvcmRlcj0iMCIgYmdjb2xvcj0iI2Y1ZjVmNSIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6I2Y1ZjVmNTtiYWNrZ3JvdW5kLWltYWdlOmxpbmVhci1ncmFkaWVudCgjZjVmNWY1LCNmNWY1ZjUpO2ZvbnQtZmFtaWx5OlNlZ29lIFVJLFRhaG9tYSxBcmlhbCxzYW5zLXNlcmlmOyI+CiAgPHRyPgogICAgPHRkIGFsaWduPSJjZW50ZXIiIGNsYXNzPSJhdGhhci1vdXRlciIgYmdjb2xvcj0iI2Y1ZjVmNSIgc3R5bGU9InBhZGRpbmc6NDBweCAyMHB4O2JhY2tncm91bmQtY29sb3I6I2Y1ZjVmNTtiYWNrZ3JvdW5kLWltYWdlOmxpbmVhci1ncmFkaWVudCgjZjVmNWY1LCNmNWY1ZjUpOyI+CiAgICAgIDx0YWJsZSByb2xlPSJwcmVzZW50YXRpb24iIGNsYXNzPSJhdGhhci1jYXJkIiB3aWR0aD0iMTAwJSIgY2VsbHNwYWNpbmc9IjAiIGNlbGxwYWRkaW5nPSIwIiBib3JkZXI9IjAiIGJnY29sb3I9IiNmZmZmZmYiIHN0eWxlPSJtYXgtd2lkdGg6NDgwcHg7YmFja2dyb3VuZC1jb2xvcjojZmZmZmZmO2JhY2tncm91bmQtaW1hZ2U6bGluZWFyLWdyYWRpZW50KCNmZmZmZmYsI2ZmZmZmZik7Ym9yZGVyLXJhZGl1czoxNnB4O2JvcmRlcjoxcHggc29saWQgI2U0ZTRlNzsiPgogICAgICAgIDx0cj4KICAgICAgICAgIDx0ZCBhbGlnbj0iY2VudGVyIiBjbGFzcz0iYXRoYXItY2FyZCIgYmdjb2xvcj0iI2ZmZmZmZiIgc3R5bGU9InBhZGRpbmc6MzJweCAyOHB4IDEycHg7YmFja2dyb3VuZC1jb2xvcjojZmZmZmZmO2JhY2tncm91bmQtaW1hZ2U6bGluZWFyLWdyYWRpZW50KCNmZmZmZmYsI2ZmZmZmZik7Ij4KICAgICAgICAgICAgPGRpdiBjbGFzcz0iYXRoYXItYnJhbmQiIHN0eWxlPSJmb250LXNpemU6MjhweDtsaW5lLWhlaWdodDoxO2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzowLjA4ZW07Y29sb3I6IzE4MTgxYjsiPkFUSEFSPC9kaXY+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImF0aGFyLW11dGVkIiBzdHlsZT0iZm9udC1zaXplOjEzcHg7bGluZS1oZWlnaHQ6MS42O2NvbG9yOiM3MTcxN2E7bWFyZ2luLXRvcDo4cHg7Ij7ZhdmG2LXYqSDYp9mE2LHYtdivINin2YTZhdiq2YPYp9mF2YTYqTwvZGl2PgogICAgICAgICAgPC90ZD4KICAgICAgICA8L3RyPgogICAgICAgIDx0cj4KICAgICAgICAgIDx0ZCBkaXI9InJ0bCIgY2xhc3M9ImF0aGFyLWNhcmQiIGJnY29sb3I9IiNmZmZmZmYiIHN0eWxlPSJwYWRkaW5nOjhweCAyOHB4IDI4cHg7dGV4dC1hbGlnbjpyaWdodDtiYWNrZ3JvdW5kLWNvbG9yOiNmZmZmZmY7YmFja2dyb3VuZC1pbWFnZTpsaW5lYXItZ3JhZGllbnQoI2ZmZmZmZiwjZmZmZmZmKTsiPgogICAgICAgICAgICA8cCBjbGFzcz0iYXRoYXItdGl0bGUiIHN0eWxlPSJtYXJnaW46MCAwIDE2cHg7Zm9udC1zaWplOjE2cHg7bGluZS1oZWlnaHQ6MS43O2NvbG9yOiMxODE4MWI7Ij7Zhdix2K3YqNin2YvYjDwvcD4KICAgICAgICAgICAgPHAgY2xhc3M9ImF0aGFyLWJvZHkiIHN0eWxlPSJtYXJnaW46MCAwIDI0cHg7Zm9udC1zaXplOjE1cHg7bGluZS1oZWlnaHQ6MS43NTtjb2xvcjojM2YzZjQ2OyI+2KrZhNmC2ZHZitmG2Kcg2LfZhNio2KfZiyDZhNil2LnYp9iv2Kkg2KrYudmK2YrZhiDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2YTYrdiz2KfYqNmDLjwvcD4KICAgICAgICAgICAgPHAgY2xhc3M9ImF0aGFyLWJvZHkiIHN0eWxlPSJtYXJnaW46MCAwIDEwcHg7Zm9udC1zaXplOjE0cHg7bGluZS1oZWlnaHQ6MS43O2NvbG9yOiMzZjNmNDY7dGV4dC1hbGlnbjpjZW50ZXI7Ij7YsdmF2LIg2KfZhNiq2K3ZgtmCINin2YTYrtin2LUg2KjZgyDZhdmGIDgg2K7Yp9mG2KfYqjwvcD4KICAgICAgICAgICAgPHRhYmxlIHJvbGU9InByZXNlbnRhdGlvbiIgY2VsbHNwYWNpbmc9IjAiIGNlbGxwYWRkaW5nPSIwIiBib3JkZXI9IjAiIGFsaWduPSJjZW50ZXIiIHN0eWxlPSJtYXJnaW46MCBhdXRvIDI0cHg7Ij4KICAgICAgICAgICAgICA8dHI+CiAgICAgICAgICAgICAgICA8dGQgZGlyPSJsdHIiIGNsYXNzPSJhdGhhci10b2tlbiIgYmdjb2xvcj0iI2ZhZmFmYSIgc3R5bGU9ImZvbnQtc2l6ZTozNHB4O2xldHRlci1zcGFjaW5nOjAuMjVlbTtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE4MTgxYjtiYWNrZ3JvdW5kLWNvbG9yOiNmYWZhZmE7YmFja2dyb3VuZC1pbWFnZTpsaW5lYXItZ3JhZGllbnQoI2ZhZmFmYSwjZmFmYWZhKTtib3JkZXI6MXB4IHNvbGlkICNlNGU0ZTc7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6MTZweCAxOHB4O3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOm5vd3JhcDsiPgogICAgICAgICAgICAgICAgICB7e1RPS0VOfX0KICAgICAgICAgICAgICAgIDwvdGQ+CiAgICAgICAgICAgICAgPC90cj4KICAgICAgICAgICAgPC90YWJsZT4KICAgICAgICAgICAgPHAgY2xhc3M9ImF0aGFyLW11dGVkIiBzdHlsZT0ibWFyZ2luOjAgMCAxNnB4O2ZvbnQtc2l6ZToxM3B4O2xpbmUtaZWlnaHQ6MS43O2NvbG9yOiM3MTcxN2E7dGV4dC1hbGlnbjpjZW50ZXI7Ij7Yp9mD2KrYqNmH2LHYp9mE2LHZhdiy2YHZiig2K3Zgdit2Kkg2YHZiiDYtdmB2K3YqSDYp9iz2KrYudin2K/YqSDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2K/Yp9iu2YQg2KfZhNmF2YbYtdipLjwvcD4KICAgICAgICAgICAgPHAgY2xhc3M9ImF0aGFyLW11dGVkIiBzdHlsZT0ibWFyZ2luOjAgMCAyMHB4O2ZvbnQtc2l6ZToxMnB4O2xpbmUtaZWlnaHQ6MS43O2NvbG9yOiM3MTcxN2E7dGV4dC1hbGlnbjpjZW50ZXI7Ij7Ypdiw2Kcg2YTZhSDYqti42YfYsSDYp9mE2LHYs9in2YTYqSDYgdin2K/ZiNmCINin2YTZiNin2LHYr9iMINiq2K3ZgtmCINmF2YYg2KfZhNio2LHZitivINi62YrYsSDYp9mE2YfYp9mFINij2Ygg2KfZhNix2LPYp9im2YQg2KfZhNiq2LHZiNmK2KzZitipLjwvcD4KICAgICAgICAgICAgPHAgY2xhc3M9ImF0aGFyLW11dGVkIiBzdHlsZT0ibWFyZ2luOjAgMCAxMnB4O2ZvbnQtc2l6ZToxM3B4O2xpbmUtaZWlnaHQ6MS42NTtjb2xvcjojNzE3MTdhOyI+2KXYsNin2YTZgSDYqtin2YTYqSDYsNmE2YPYgyDYqtis2KfZh9mEINmH2LDZh9in2YTYsdiz2KfYqNmDLjwvcD4KICAgICAgICAgICAgPHAgY2xhc3M9ImF0aGFyLW11dGVkIiBzdHlsZT0ibWFyZ2luOjA7Zm9udC1zaXplOjEycHg7bGluZS1oZWlnaHQ6MS42O2NvbG9yOiM3MTcxN2E7Ij7Yp9mE2LHZhdiyINi12KfZhNitINmE2YXYsdipINmI2KfYrdiv2Kkg2YjZhNmF2K/YqSDZhdit2K/ZiNiv2KkuPC9wPgogICAgICAgICAgPC90ZD4KICAgICAgICA8L3RyPgogICAgICA8L3RhYmxlPgogICAgPC90ZD4KICA8L3RyPgo8L3RhYmxlPgo8L2JvZHk+CjwvaHRtbD4K';
const SUBJECT_B64 = '2KXYudin2K/YqSDYqti52YrZitmGINmD2YTZhdipINin2YTZhdix2YjYsSDigJQgQVRIQVI=';
const TEXT_B64 = '2LHZhdiyINil2LnYp9iv2Kkg2KrYudmK2YrZhiDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2KfZhNiu2KfYtSDYqNmDOiB7e1RPS0VOfX0g4oCUINin2YPYqtio2Ycg2YHZiiDYtdmB2K3YqSDYp9iz2KrYudin2K/YqSDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2K/Yp9iu2YQg2KfZhNmF2YbYtdipLiDYtdin2YTYrSDZhNmF2LHYqSDZiNin2K3Yr9ipINmI2YTZhdiv2Kkg2YXYrdiv2YjYr9ipLg==';

const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

function b64utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function buildRecoveryEmail(token: string): { subject: string; html: string; text: string } {
  return {
    subject: b64utf8(SUBJECT_B64),
    html: b64utf8(HTML_B64).replaceAll('{{TOKEN}}', token),
    text: b64utf8(TEXT_B64).replaceAll('{{TOKEN}}', token),
  };
}

function parseSender(raw: string): { name: string; email: string } {
  const trimmed = raw.trim();
  const bracket = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (bracket) {
    return { name: bracket[1].trim(), email: bracket[2].trim() };
  }
  const email = trimmed.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? trimmed;
  return { name: 'ATHAR', email };
}

function formatSender(raw: string): string {
  const { name, email } = parseSender(raw);
  return `${name} <${email}>`;
}

function senderDomain(raw: string): string | null {
  const { email } = parseSender(raw);
  const match = email.match(/@([^>\s]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function isAppleMailbox(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return APPLE_DOMAINS.has(domain);
}

function brevoConfigured(): boolean {
  return Boolean(BREVO_API_KEY && BREVO_FROM);
}

type EmailActionType = 'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change' | 'email';

type WebhookPayload = {
  user: { id: string; email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: EmailActionType;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sendViaBrevo(to: string, subject: string, html: string, text: string): Promise<void> {
  const sender = parseSender(BREVO_FROM);

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  const raw = await response.text();
  let body: { message?: string; code?: string } = {};
  try {
    body = JSON.parse(raw) as { message?: string; code?: string };
  } catch {
    body = { message: raw.slice(0, 500) };
  }

  if (!response.ok) {
    const detail = body.message || body.code || raw.slice(0, 300) || response.statusText;
    console.error('send-auth-emails: brevo error status=' + response.status + ' body=' + raw.slice(0, 500));
    if (/sender|not valid|not verified|domain|from/i.test(detail)) {
      throw new Error(
        'Brevo rejected sender ' + sender.email +
        '. In Brevo add no-reply@athar-app.online under Senders (verified). Details: ' + detail,
      );
    }
    if (/unauthorized|api.?key|authentication|401|403/i.test(detail + response.status)) {
      throw new Error('Brevo API key invalid or missing permissions. Use xkeysib- key with Send emails permission. Details: ' + detail);
    }
    throw new Error('Brevo API send failed (' + response.status + '): ' + detail);
  }

  console.log('send-auth-emails: brevo sent to ' + to);
}

async function pingBrevo(): Promise<{ ok: boolean; detail: unknown }> {
  const response = await fetch('https://api.brevo.com/v3/account', {
    headers: { accept: 'application/json', 'api-key': BREVO_API_KEY },
  });
  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    // keep raw text
  }
  return { ok: response.ok, detail: { status: response.status, body } };
}

async function brevoGet(path: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch('https://api.brevo.com/v3' + path, {
    headers: { accept: 'application/json', 'api-key': BREVO_API_KEY },
  });
  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    // keep raw text
  }
  return { ok: response.ok, status: response.status, body };
}

async function sendViaResend(to: string, subject: string, html: string, text: string): Promise<void> {
  if (!resend) {
    throw new Error('Resend is not configured');
  }

  const { error } = await resend.emails.send({
    from: formatSender(SENDER_EMAIL),
    to: [to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error((error as { message?: string }).message || 'Resend send failed');
  }

  console.log('send-auth-emails: resend sent to ' + to);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    const domain = senderDomain(SENDER_EMAIL);
    const brevoReady = brevoConfigured();
    const brevoPing = brevoReady && url.searchParams.get('brevo_ping') === '1'
      ? await pingBrevo()
      : null;
    const brevoDiag = brevoReady && url.searchParams.get('brevo_diag') === '1'
      ? {
        senders: await brevoGet('/senders'),
        domains: await brevoGet('/senders/domains'),
        test_send: url.searchParams.get('test_to')
          ? await (async () => {
            try {
              await sendViaBrevo(
                url.searchParams.get('test_to')!,
                'ATHAR Brevo test',
                '<p>ATHAR Brevo test</p>',
                'If you receive this, Brevo delivery works.',
              );
              return { ok: true };
            } catch (error) {
              return { ok: false, error: error instanceof Error ? error.message : String(error) };
            }
          })()
          : null,
      }
      : null;
    return json({
      ok: true,
      configured: {
        RESEND_API_KEY: Boolean(RESEND_API_KEY),
        SEND_EMAIL_HOOK_SECRET: Boolean(HOOK_SECRET),
        SENDER_EMAIL: Boolean(SENDER_EMAIL),
        BREVO_API_KEY: Boolean(BREVO_API_KEY),
        BREVO_FROM: BREVO_FROM,
        BREVO_FALLBACK: brevoReady,
      },
      deliverability: {
        sender_domain: domain,
        uses_resend_shared_domain: domain === 'resend.dev',
        template: 'arabic-html',
        apple_mail_route: brevoReady ? 'brevo-api' : 'resend',
        apple_hm08_risk_without_brevo: !brevoReady,
        note: 'Supabase Edge Functions cannot use SMTP ports 25/465/587. Use BREVO_API_KEY (HTTP API), not SMTP.',
        warning: !brevoReady
          ? 'Apple/iCloud may bounce on Resend (HM08). Add BREVO_API_KEY and BREVO_FROM in Supabase Secrets.'
          : !RESEND_API_KEY
          ? 'RESEND_API_KEY missing — Gmail/non-Apple emails will fail. Re-add RESEND_API_KEY secret.'
          : null,
      },
      brevo_ping: brevoPing,
      brevo_diag: brevoDiag,
    });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  if (!HOOK_SECRET || !SENDER_EMAIL || (!resend && !brevoConfigured())) {
    console.error('send-auth-emails: missing email provider configuration');
    return json({ error: { message: 'Email hook is not configured' } }, 500);
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const wh = new Webhook(HOOK_SECRET.replace('v1,whsec_', ''));

  try {
    const { user, email_data } = wh.verify(payload, headers) as WebhookPayload;
    const action = email_data.email_action_type;

    if (action !== 'recovery') {
      console.warn('send-auth-emails: unsupported action ' + action);
      return json({ success: true, skipped: action });
    }

    const token = String(email_data.token ?? '').trim();
    if (!token) {
      throw new Error('Recovery email missing token');
    }

    const mail = buildRecoveryEmail(token);
    const apple = isAppleMailbox(user.email);
    const useBrevo = apple && brevoConfigured();

    if (apple && !brevoConfigured()) {
      console.warn(
        'send-auth-emails: Apple mailbox without Brevo fallback — Resend may bounce HM08 for ' + user.email,
      );
    }

    if (useBrevo) {
      await sendViaBrevo(user.email, mail.subject, mail.html, mail.text);
    } else {
      await sendViaResend(user.email, mail.subject, mail.html, mail.text);
    }

    return json({ success: true, provider: useBrevo ? 'brevo' : 'resend' });
  } catch (error) {
    console.error('send-auth-emails:', error);
    return json({
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
});
