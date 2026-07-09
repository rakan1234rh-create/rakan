import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';

// Brevo disabled as per user request due to iCloud delivery issues (HM08).
// Resend is now the primary and only provider for all email domains.
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Arabic recovery template (base64 UTF-8) — see supabase/email-templates/athar-recovery-simple.html
const HTML_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImFyIiBkaXI9InJ0bCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGh0bWwiIHhtbG5zOnY9InVybjpzY2hlbWFzLW1pY3Jvc29mdC1jb206dm1sIiB4bWxuczpvPSJ1cm46c2NoZW1hcy1taWNyb3NvZnQtY29tOm9mZmljZTpvZmZpY2UiPgo8aGVhZD4KICA8bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CiAgPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgogIDxtZXRhIG5hbWU9ImNvbG9yLXNjaGVtZSIgY29udGVudD0ibGlnaHQgb25seSI+CiAgPG1ldGEgbmFtZT0ic3VwcG9ydGVkLWNvbG9yLXNjaGVtZXMiIGNvbnRlbnQ9ImxpZ2h0Ij4KICA8IS0tW2lmIG1zb10+PHhtbD48bzpPZmZpY2VEb2N1bWVudFNldHRpbmdzPjxvOlBpeGVsc1BlckluY2g+OTY8L286UGl4ZWxzUGVySW5jaD48L286T2ZmaWNlRG9jdW1lbnRTZXR0aW5ncz48L3htbD48IVtlbmRpZl0tLT4KICA8c3R5bGU+CiAgICA6cm9vdCB7IGNvbG9yLXNjaGVtZTogbGlnaHQgb25seTsgc3VwcG9ydGVkLWNvbG9yLXNjaGVtZXM6IGxpZ2h0OyB9CiAgICBib2R5LCB0YWJsZSwgdGQsIHAsIGRpdiwgc3BhbiB7IGNvbG9yLXNjaGVtZTogbGlnaHQgb25seTsgfQogICAgLmF0aGFyLW91dGVyIHsgYmFja2dyb3VuZC1jb2xvcjogI2Y1ZjVmNSAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2Y1ZjVmNSwgI2Y1ZjVmNSkgIWltcG9ydGFudDsgfQogICAgLmF0aGFyLWNhcmQgeyBiYWNrZ3JvdW5kLWNvbG9yOiAjZmZmZmZmICFpbXBvcnRhbnQ7IGJhY2tncm91bmQtaW1hZ2U6 bGluZWFyLWdyYWRpZW50KCNmZmZmZmYsICNmZmZmZmYpICFpbXBvcnRhbnQ7IH0KICAgIC4YXRoYXItdG9rZW4geyBiYWNrZ3JvdW5kLWNvbG9yOiAjZmFmYWZhICFpbXBvcnRhbnQ7IGJhY2tncm91bmQtaW1hZ2U6 bGluZWFyLWdyYWRpZW50KCNmYWZhZmEsICNmYWZhZmEpICFpbXBvcnRhbnQ7IGNvbG9yOiAjMTgxODFiICFpbXBvcnRhbnQ7IH0KICAgIC4YXRoYXItdGl0bGUgeyBjb2xvcjogIzE4MTgxYiAhaW1wb3J0YW50OyB9CiAgICAuYXRoYXItYm9keSB7IGNvbG9yOiAjM2YzZjQ2ICFpbXBvcnRhbnQ7IH0KICAgIC4YXRoYXIttdXRlZCB7IGNvbG9yOiAjNzE3MTdhICFpbXBvcnRhbnQ7IH0KICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHsKICAgICAgLmF0aGFyLW91dGVyIHsgYmFja2dyb3VuZC1jb2xvcjogI2Y1ZjVmNSAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2Y1ZjVmNSwgI2Y1ZjVmNSkgIWltcG9ydGFudDsgfQogICAgICAuYXRoYXItY2FyZCB7IGJhY2tncm91bmQtY29sb3I6ICNmZmZmZmYgIWltcG9ydGFudDsgYmFja2dyb3VuZC1pbWFnZTogbGluZWFyLWdyYWRpZW50KCNmZmZmZmYsICNmZmZmZmYpICFpbXBvcnRhbnQ7IH0KICAgICAgLmF0aGFyLXRva2VuIHsgYmFja2dyb3VuZC1jb2xvcjogI2ZhZmFmYSAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2ZhZmFmYSwgI2ZhZmFmYSkgIWltcG9ydGFudDsgY29sb3I6ICMxODE4MWIgIWltcG9ydGFudDsgfQogICAgICAuYXRoYXItdGl0bGUgeyBjb2xvcjogIzE4MTgxYiAhaW1wb3J0YW50OyB9CiAgICAgIC5hdGhhci1ib2R5IHsgY29sb3I6ICMzZjNmNDYgIWltcG9ydGFudDsgfQogICAgICAuYXRoYXItbXV0ZWQgeyBjb2xvcjogIzcxNzE3YSAhaW1wb3J0YW50OyB9CiAgICB9CiAgICB1ICsgLmJvZHkgLmF0aGFyLW91dGVyIHsgYmFja2dyb3VuZC1jb2xvcjogI2Y1ZjVmNSAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2Y1ZjVmNSwgI2Y1ZjVmNSkgIWltcG9ydGFudDsgfQogICAgdSArIC5ib2R5IC5hdGhhci1jYXJkIHsgYmFja2dyb3VuZC1jb2xvcjogI2ZmZmZmZiAhaW1wb3J0YW50OyBiYWNrZ3JvdW5kLWltYWdlOiBsaW5lYXItZ3JhZGllbnQoI2ZmZmZmZiwgI2ZmZmZmZikgIWltcG9ydGFudDsgfQogICAgdSArIC5ib2R5IC5hdGhhci10b2tlbiB7IGJhY2tncm91bmQtY29sb3I6ICNmYWZhZmEgIWltcG9ydGFudDsgYmFja2dyb3VuZC1pbWFnZTogbGluZWFyLWdyYWRpZW50KCNmYWZhZmEsICNmYWZhZmEpICFpbXBvcnRhbnQ7IGNvbG9yOiAjMTgxODFiICFpbXBvcnRhbnQ7IH0KICAgIHUgKyAuYm9keSAuYXRoYXItdGl0bGUgeyBjb2xvcjogIzE4MTgxYiAhaW1wb3J0YW50OyB9CiAgICB1ICsgLmJvZHkgLmF0aGFyLWJvZHkgeyBjb2xvcjogIzNmM2Y0NiAhaW1wb3J0YW50OyB9CiAgICB1ICsgLmJvZHkgLmF0aGFyLW11dGVkIHsgY29sb3I6ICM3MTcxN2EgIWltcG9ydGFudDsgfQogICAgW2RhdGEtb2dzY10gLmF0aGFyLW91dGVyIHsgYmFja2dyb3VuZC1jb2xvcjogI2Y1ZjVmNSAhaW1wb3J0YW50OyB9CiAgICBbZGF0YS1vZ3NjXSAuYXRoYXItY2FyZCB7IGJhY2tncm91bmQtY29sb3I6ICNmZmZmZmYgIWltcG9ydGFudDsgfQogICAgW2RhdGEtb2dzY10gLmF0aGFyLXRpdGxlIHsgY29sb3I6ICMxODE4MWIgIWltcG9ydGFudDsgfQogICAgW2RhdGEtb2dzY10gLmF0aGFyLWJvZHkgeyBjb2xvcjogIzNmM2Y0NiAhaW1wb3J0YW50OyB9CiAgICBbZGF0YS1vZ3NjXSAuYXRoYXItbXV0ZWQgeyBjb2xvcjogIzcxNzE3YSAhaW1wb3J0YW50OyB9CiAgICBbZGF0YS1vZ3NjXSAuYXRoYXItdG9rZW4geyBiYWNrZ3JvdW5kLWNvbG9yOiAjZmFmYWZhICFpbXBvcnRhbnQ7IGNvbG9yOiAjMTgxODFiICFpbXBvcnRhbnQ7IH0KICA8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5IGNsYXNzPSJib2R5IiBzdHlsZT0ibWFyZ2luOjA7cGFkZGluZzowO2JhY2tncm91bmQtY29sb3I6I2Y1ZjVmNTsiPgo8dGFibGUgcm9sZT0icHJlc2VudGF0aW9uIiBjbGFzcz0iYXRoYXItb3V0ZXIiIHdpZHRoPSIxMDAlIiBjZWxsc3BhY2luZz0iMCIgY2VsbHBhZGRpbmc9IjAiIGJvcmRlcj0iMCIgYmdjb2xvcj0iI2Y1ZjVmNSIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6I2Y1ZjVmNTtiYWNrZ3JvdW5kLWltYWdlOmxpbmVhci1ncmFkaWVudCgjZjVmNWY1LCNmNWY1ZjUpO2ZvbnQtZmFtaWx5OlNlZ29lIFVJLFRhaG9tYSxBcmlhbCxzYW5zLXNlcmlmOyI+CiAgPHRyPgogICAgPHRkIGFsaWduPSJjZW50ZXIiIGNsYXNzPSJhdGhhci1vdXRlciIgYmdjb2xvcj0iI2Y1ZjVmNSIgc3R5bGU9InBhZGRpbmc6NDBweCAyMHB4O2JhY2tncm91bmQtY29sb3I6I2Y1ZjVmNTtiYWNrZ3JvdW5kLWltYWdlOmxpbmVhci1ncmFkaWVudCgjZjVmNWY1LCNmNWY1ZjUpOyI+CiAgICAgIDx0YWJsZSByb2xlPSJwcmVzZW50YXRpb24iIGNsYXNzPSJhdGhhci1jYXJkIiB3aWR0aD0iMTAwJSIgY2VsbHNwYWNpbmc9IjAiIGNlbGxwYWRkaW5nPSIwIiBib3JkZXI9IjAiIGJnY29sb3I9IiNmZmZmZmYiIHN0eWxlPSJtYXgtd2lkdGg6NDgwcHg7YmFja2dyb3VuZC1jb2xvcjojZmZmZmZmO2JhY2tncm91bmQtaW1hZ2U6bGluZWFyLWdyYWRpZW50KCNmZmZmZmYsI2ZmZmZmZik7Ym9yZGVyLXJhZGl1czoxNnB4O2JvcmRlcjoxcHggc29saWQgI2U0ZTRlNzsiPgogICAgICAgIDx0cj4KICAgICAgICAgIDx0ZCBhbGlnbj0iY2VudGVyIiBjbGFzcz0iYXRoYXItY2FyZCIgYmdjb2xvcj0iI2ZmZmZmZiIgc3R5bGU9InBhZGRpbmc6MzJweCAyOHB4IDE2cHg7YmFja2dyb3VuZC1jb2xvcjojZmZmZmZmO2JhY2tncm91bmQtaW1hZ2U6bGluZWFyLWdyYWRpZW50KCNmZmZmZmYsI2ZmZmZmZik7Ij4KICAgICAgICAgICAgPGltZyBzcmM9Imh0dHBzOi8vYXRoYXItYXBwLm9ubGluZS9pY29ucy9hdGhhci13b3JkbWFyay1lbWFpbC12Mzg4LnBuZyIgd2lkdGg9IjI0MCIgaGVpZ2h0PSIxNDgiIGFsdD0iQVRIQVIiIHN0eWxlPSJkaXNwbGF5OmJsb2NrO3dpZHRoOjI0MHB4O21heC13aWR0aDoxMDAlO2hlaWdodDphdXRvO2JvcmRlcjowO21hcmdpbjowIGF1dG87Ij4KICAgICAgICAgIDwvdGQ+CiAgICAgICAgPC90cj4KICAgICAgICA8dHI+CiAgICAgICAgICA8dGQgZGlyPSJydGwiIGNsYXNzPSJhdGhhci1jYXJkIiBiZ2NvbG9yPSIjZmZmZmZmIiBzdHlsZT0icGFkZGluZzo4cHggMjhweCAyOHB4O3RleHQtYWxpZ246cmlnaHQ7YmFja2dyb3VuZC1jb2xvcjojZmZmZmZmO2JhY2tncm91bmQtaW1hZ2U6bGluZWFyLWdyYWRpZW50KCNmZmZmZmYsI2ZmZmZmZik7Ij4KICAgICAgICAgICAgPHAgY2xhc3M9ImF0aGFyLXRpdGxlIiBzdHlsZT0ibWFyZ2luOjAgMCAxNnB4O2ZvbnQtc2l6ZToxNnB4O2xpbmUtaGVpZ2h0OjEuNztjb2xvcjojMTgxODFiOyI+2YXYsdit2KjYp9mL2Iw8L3A+CiAgICAgICAgICAgIDxwIGNsYXNzPSJhdGhhci1ib2R5IiBzdHlsZT0ibWFyZ2luOjAgMCAyNHB4O2ZvbnQtc2l6ZToxNXB4O2xpbmUtaGVpZ2h0OjEuNzU7Y29sb3I6IzNmM2Y0NjsiPtiq2YTZgtmR2YrZhtinINi32YTYqNin2Ysg2YTYpdi52KfYr9ipINiq2LnZitmK2YYg2YPZhNmF2Kkg2KfZhNmF2LHZiNixINmE2K3Ys9in2KjZgy48L3A+CiAgICAgICAgICAgIDxwIGNsYXNzPSJhdGhhci1ib2R5IiBzdHlsZT0ibWFyZ2luOjAgMCAxMHB4O2ZvbnQtc2l6ZToxNHB4O2xpbmUtaGVpZ2h0OjEuNztjb2xvcjojM2YzZjQ2O3RleHQtYWxpZ246Y2VudGVyOyI+2LHZhdiyINin2YTYqtit2YLZgiDYp9mE2K7Yp9i1INio2YM8L3A+CiAgICAgICAgICAgIDx0YWJsZSByb2xlPSJwcmVzZW50YXRpb24iIGNlbGxzcGFjaW5nPSIwIiBjZWxscGFkZGluZz0iMCIgYm9yZGVyPSIwIiBhbGlnbj0iY2VudGVyIiBzdHlsZT0ibWFyZ2luOjAgYXV0byAyNHB4OyI+CiAgICAgICAgICAgICAgPHRyPgogICAgICAgICAgICAgICAgPHRkIGRpcj0ibHRyIiBjbGFzcz0iYXRoYXItdG9rZW4iIGJnY29sb3I9IiNmYWZhZmEiIHN0eWxlPSJmb250LXNpemU6MzRweDtsZXR0ZXItc3BhY2luZzowLjI1ZW07Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMxODE4MWI7YmFja2dyb3VuZC1jb2xvcjojZmFmYWZhO2JhY2tncm91bmQtaW1hZ2U6bGluZWFyLWdyYWRpZW50KCNmYWZhZmEsI2ZhZmFmYSk7Ym9yZGVyOjFweCBzb2xpZCAjZTRlNGU3O2JvcmRlci1yYWRpdXM6MTRweDtwYWRkaW5nOjE2cHggMThweDt0ZXh0LWFsaWduOmNlbnRlcjt3aGl0ZS1zcGFjZTpub3dyYXA7Ij4KICAgICAgICAgICAgICAgICAge3tUT0tFTn19CiAgICAgICAgICAgICAgICA8L3RkPgogICAgICAgICAgICAgIDwvdHI+CiAgICAgICAgICAgIDwvdGFibGU+CiAgICAgICAgICAgIDxwIGNsYXNzPSJhdGhhci1tdXRlZCIgc3R5bGU9Im1hcmdpbjowIDAgMThweDtmb250LXNpemU6MTNweDtsaW5lLWhlaWdodDoxLjc7Y29sb3I6IzcxNzE3YTt0ZXh0LWFsaWduOmNlbnRlcjsiPtin2YPYqtioINmH2LDYpyDYp9mE2LHZhdiyINmB2Yog2LXZgdit2Kkg2KfYs9iq2LnYp9iv2Kkg2YPZhNmF2Kkg2KfZhNmF2LHZiNixINiv2KfYrtmEINin2YTZhdmG2LXYqS48L3A+CiAgICAgICAgICAgIDxwIGNsYXNzPSJhdGhhci1tdXRlZCIgc3R5bGU9Im1hcmdpbjowIDAgMTJweDtmb250LXNpemU6MTNweDtsaW5lLWhlaWdodDoxLjY1O2NvbG9yOiM3MTcxN2E7Ij7Ypdiw2Kcg2YTZhSDYqti32YTYqCDYsNmE2YPYjCDYqtis2KfZh9mEINmH2LDZhyDYp9mE2LHYs9in2YTYqS48L3A+CiAgICAgICAgICAgIDxwIGNsYXNzPSJhdGhhci1tdXRlZCIgc3R5bGU9Im1hcmdpbjowO2ZvbnQtc2l6ZToxMnB4O2xpbmUtaGVpZ2h0OjEuNjtjb2xvcjojNzE3MTdhOyI+2KfZhNix2YXYsiDYtdin2YTYrSDZhNmF2LHYqSDZiNin2K3Yr9ipINmI2YTZhdiv2Kkg2YXYrdiv2YjYr9ipLjwvcD4KICAgICAgICAgIDwvdGQ+CiAgICAgICAgPC90cj4KICAgICAgPC90YWJsZT4KICAgIDwvdGQ+CiAgPC90cj4KPC90YWJsZT4KPC9ib2R5Pgo8L2h0bWw+Cg==';
const SUBJECT_B64 = '2KXYudin2K/YqSDYqti52YrZitmGINmD2YTZhdipINin2YTZhdix2YjYsSDigJQgQVRIQVI=';
const TEXT_B64 = '2LHZhdiyINil2LnYp9iv2Kkg2KrYudmK2YrZhiDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2KfZhNiu2KfYtSDYqNmDOiB7e1RPS0VOfX0g4oCUINin2YPYqtio2Ycg2YHZiiDYtdmB2K3YqSDYp9iz2KrYudin2K/YqSDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2K/Yp9iu2YQg2KfZhNmF2YbYtdipLiDYtdin2YTYrSDZhNmF2LHYqSDZiNin2K3Yr9ipINmI2YTZhdiv2Kkg2YXYrdiv2YjYr9ipLg==';

function b64utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function buildRecoveryEmail(token: string): { subject: string; html: string; text: string; deliveryRef: string } {
  const deliveryRef = crypto.randomUUID();
  const htmlCore = b64utf8(HTML_B64).replaceAll('{{TOKEN}}', token);
  // Unique invisible marker per send — prevents Gmail/iCloud stacking without changing visible layout.
  const html = htmlCore +
    `<!-- athar-delivery:${deliveryRef} -->` +
    `<div style="display:none!important;max-height:0;overflow:hidden;font-size:0;line-height:0;color:transparent;mso-hide:all" aria-hidden="true">&#8203;${deliveryRef}</div>`;
  return {
    subject: b64utf8(SUBJECT_B64) + invisibleSubjectSuffix(deliveryRef),
    html,
    text: b64utf8(TEXT_B64).replaceAll('{{TOKEN}}', token),
    deliveryRef,
  };
}

/** Zero-width chars — invisible in inbox subject, breaks client-side conversation threading. */
function invisibleSubjectSuffix(ref: string): string {
  const n = (ref.charCodeAt(0) + ref.charCodeAt(ref.length - 1)) % 8 + 1;
  return '\u200C'.repeat(n);
}

function antiThreadHeaders(deliveryRef: string): Record<string, string> {
  return {
    'X-Entity-Ref-ID': deliveryRef,
    'X-ATHAR-Delivery': deliveryRef,
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

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
  deliveryRef: string,
): Promise<void> {
  if (!resend) {
    throw new Error('Resend is not configured');
  }

  const from = formatSender(SENDER_EMAIL);
  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html,
    text,
    headers: antiThreadHeaders(deliveryRef),
  });

  if (error) {
    const msg = (error as { message?: string; name?: string }).message || 'Resend send failed';
    console.error('send-auth-emails: resend error from=' + from + ' to=' + to + ' msg=' + msg);
    if (/domain|verify|not verified|invalid.*from|sender/i.test(msg)) {
      throw new Error(
        'Resend rejected sender ' + parseSender(SENDER_EMAIL).email +
        '. Verify athar-app.online in Resend Domains and set SENDER_EMAIL to no-reply@athar-app.online. Details: ' + msg,
      );
    }
    throw new Error(msg);
  }

  console.log('send-auth-emails: resend sent to ' + to + ' id=' + (data as { id?: string })?.id);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    const domain = senderDomain(SENDER_EMAIL);
    const testTo = url.searchParams.get('test_to');
    const resendDiag = resend && url.searchParams.get('resend_diag') === '1'
      ? {
        sender: formatSender(SENDER_EMAIL),
        test_send: testTo
          ? await (async () => {
            try {
              const mail = buildRecoveryEmail('12345678');
              await sendViaResend(testTo, mail.subject, mail.html, mail.text, mail.deliveryRef);
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
        BREVO_ENABLED: false,
      },
      deliverability: {
        sender_domain: domain,
        uses_resend_shared_domain: domain === 'resend.dev',
        template: 'arabic-html-wordmark-url',
        primary_route: 'resend',
        note: 'Brevo has been disabled. Resend is now used for all emails including iCloud/Apple.',
      },
      resend_diag: resendDiag,
    });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  if (!HOOK_SECRET || !SENDER_EMAIL || !resend) {
    console.error('send-auth-emails: missing Resend configuration');
    return json({ error: { message: 'Email provider (Resend) is not configured' } }, 500);
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
    
    // Always use Resend now
    await sendViaResend(user.email, mail.subject, mail.html, mail.text, mail.deliveryRef);

    return json({ success: true, provider: 'resend' });
  } catch (error) {
    console.error('send-auth-emails:', error);
    return json({
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
});
