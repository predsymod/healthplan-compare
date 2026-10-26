export const usd = (n: number | null) =>
  n === null ? "n/a" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Plan names often already start with the insurer name; avoid saying it twice.
export const planLabel = (p: { issuer: string; name: string }) =>
  p.name.toLowerCase().startsWith(p.issuer.toLowerCase()) ? p.name : `${p.issuer} · ${p.name}`;
