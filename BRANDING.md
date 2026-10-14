# CHAINeS POST brand guide

The master logo is `static/brand/v2/logo.svg`: interlocking silver and gold links
on a midnight blue badge. Use this SVG for page headers, login, desktop console
launchers, wallet branding, favicons, and install dialogs. The files at
`static/logo.svg` and `static/mascot.svg` are compatibility copies of this master.

The tagline is “Create. Share. Stream. Discover.” The community description is
“Connected creator network.”

| Role | Color |
| --- | --- |
| Background | `#091427` |
| Panel | `#101d35` |
| Text / silver | `#eef3ff` |
| Muted text | `#acb9d0` |
| Blue accent | `#76b9eb` |
| Gold | `#e5b35c` |
| Light gold | `#f5d48b` |
| Border | `#344765` |

Use `static/brand-theme.css` for shared colors and surfaces. Preserve accessible
light-mode alternatives and user-selected themes. Poppins is the primary font.

Installed-app assets are exports of the same master SVG, rather than separate
artwork: `logo-180.png` for Apple, `logo-192.png` and `logo-512.png` for install
fallbacks, and `logo-maskable-512.png` with safe padding for Android. The SVG is
also declared in the manifest. Regenerate these exports whenever the master changes.
Notifications use the PNG logo; `logo-badge-96.png` contains its white chain mark
on transparency for notification badges. All published icon URLs are versioned.

Keep action icons recognizable in the silver-and-gold family. Brand launchers
use the full master logo. Do not restore the earlier neon-blue mark or wolf mascot.
