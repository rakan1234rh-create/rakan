import { normalizedClientIp, verifiedManagedClientIp } from "./client-ip.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("client IP contract is opt-in and never trusts first XFF", () => {
  const req = new Request("https://test.invalid", {
    headers: {
      "cf-connecting-ip": "198.51.100.8",
      "x-forwarded-for": "203.0.113.9, 198.51.100.8",
    },
  });
  assert(verifiedManagedClientIp(req) === null, "default must fail closed");
  assert(
    verifiedManagedClientIp(req, true) === "198.51.100.8",
    "last-hop contract",
  );
  const forged = new Request("https://test.invalid", {
    headers: {
      "cf-connecting-ip": "198.51.100.8",
      "x-forwarded-for": "198.51.100.8, 203.0.113.9",
    },
  });
  assert(
    verifiedManagedClientIp(forged, true) === null,
    "mismatch must fail closed",
  );
});
Deno.test("IP syntax canonicalization rejects malformed IPv6 and hosts", () => {
  for (
    const bad of ["host.example", "1:2", ":::1", "fe80::1%eth0", "256.1.1.1"]
  ) {
    assert(normalizedClientIp(bad) === null, `invalid IP ${bad}`);
  }
  assert(
    normalizedClientIp("2001:0db8::1") === "2001:db8::1",
    "canonical IPv6",
  );
  assert(
    normalizedClientIp("198.051.100.008") === "198.51.100.8",
    "canonical IPv4",
  );
});
