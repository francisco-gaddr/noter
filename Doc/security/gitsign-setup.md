# Sigstore gitsign — commit signing setup

Vi använder Sigstore [`gitsign`](https://github.com/sigstore/gitsign) för
keyless commit-signering. Identiteten kommer från en OIDC-issuer
(GitHub eller Google Workspace). Loggen hamnar på publik Rekor så vi
kan revisionsspåra varje commit i historien.

## Installation

```bash
# macOS
brew install sigstore/tap/gitsign

# Linux
go install github.com/sigstore/gitsign@latest

# Windows
scoop install gitsign  # via sigstore bucket
```

## Aktivera per repo

```bash
cd /path/to/Noter
git config --local gpg.x509.program gitsign
git config --local gpg.format x509
git config --local commit.gpgsign true
git config --local tag.gpgsign true
git config --local gitsign.connectorID https://github.com/login/oauth
git config --local gitsign.fulcio https://fulcio.sigstore.dev
git config --local gitsign.rekor https://rekor.sigstore.dev
git config --local gitsign.issuer https://oauth2.sigstore.dev/auth
```

## Verifiera

```bash
git log --show-signature -1
# Should show: "gitsign: Good signature from [https://github.com/<user>]"
```

CI verifierar varje commit i `gitsign-verify.yml`-workflowen genom
`gitsign verify <sha>`.

## Försvar mot identity-spoofing

Vi tillåter bara commits från identities som matchar regex
`^[a-z0-9._-]+@(noter\.app|users\.noreply\.github\.com)$`. Allt utanför
det blockas av branch-protection-rule + verify-workflowen.
