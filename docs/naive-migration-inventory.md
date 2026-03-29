# Naive UI Migration Inventory

## Active Style Layers
- `base.css` (global reset and font stack)
- `tokens.css` (theme tokens)
- `naive-migration.css` (App shell and toolbar)
- `layout.css` (shared card/shell frame)
- `components.css` (shared utility classes)
- `pages/*.css` (route-level layout and component composition)

## Cleanup Status
- removed historical stylesheet bundles and scoped compatibility assets
- removed deprecated workspace/fallback pages and their dedicated UI components
- removed obsolete utility selectors not referenced by active routes
