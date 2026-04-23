# UI Design Update - Vistaar Style

## Overview
Updated the Location Pockets application UI to match the Vistaar QC design system based on the provided HTML reference files.

## Design Changes Applied

### 1. Color Scheme
Updated theme colors to match Vistaar branding:
- **Primary Blue**: `#1E40AF` (rgb(30, 64, 175))
- **Secondary Green**: `#059669` (rgb(5, 150, 105))
- **Background**: `#F8FAFC` (rgb(248, 250, 252))
- **Card Background**: `#FFFFFF` with `#F1F5F9` borders
- **Text Colors**:
  - Primary: `#0F172A` (rgb(15, 23, 42))
  - Secondary: `#64748B` (rgb(100, 116, 139))
  - Disabled: `#94A3B8` (rgb(148, 163, 184))
- **Divider**: `#E2E8F0` (rgb(226, 232, 240))

### 2. Typography
- **Font Family**: "Plus Jakarta Sans" (imported from Google Fonts)
- **Fallback**: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif
- **Font Weights**: 300, 400, 500, 600, 700, 800
- **Sizes**: Reduced to match Vistaar's compact design (13px-15px for body text)

### 3. Layout Structure
Changed from top AppBar to sidebar navigation:
- **Sidebar Width**: 240px
- **Logo Section**: Gradient logo box (LP) with app name and subtitle
- **Navigation**: Vertical list with icons and labels
- **Active State**: Blue background with increased font weight
- **Footer**: User profile section at bottom

### 4. Component Styling
- **Border Radius**: 8px for buttons, 12px for cards
- **Shadows**: Removed heavy shadows, using subtle borders instead
- **Cards**: White background with 1px border (#F1F5F9)
- **Buttons**: Rounded corners, no text transform, 500 font weight
- **Tabs**: Minimal style with bottom border indicator

### 5. Navigation Items
Updated navigation structure:
- Dashboard (home icon)
- Configuration (settings icon)
- Branches (business icon)
- Calculator (calculate icon)
- Batch Processing (cloud upload icon)

### 6. Branding Elements
- **Logo**: Gradient box with "LP" initials
- **App Name**: "Location Pockets"
- **Subtitle**: "Territory Management"
- **User Section**: Avatar with name and role

## Files Modified

1. **frontend/src/theme.ts**
   - Updated color palette
   - Changed typography to Plus Jakarta Sans
   - Updated component overrides for buttons, cards, tabs

2. **frontend/src/components/Layout.tsx**
   - Replaced AppBar with Drawer (sidebar)
   - Added logo/brand section
   - Implemented vertical navigation
   - Added user profile footer

3. **frontend/index.html**
   - Added Google Fonts import for Plus Jakarta Sans

## Visual Improvements

- Cleaner, more professional appearance
- Better visual hierarchy with consistent spacing
- Improved readability with optimized font sizes
- Modern sidebar navigation pattern
- Consistent color scheme throughout

## Next Steps

To fully match the Vistaar design, consider:
1. Update individual page layouts to use the card-based design
2. Add tab navigation to pages with multiple views
3. Implement status badges with colored backgrounds
4. Add hover effects to interactive elements
5. Update table styling to match the clean, minimal design

## Testing

After these changes, test the application to ensure:
- Navigation works correctly
- Active states display properly
- Colors are consistent across all pages
- Font loads correctly
- Responsive behavior is maintained
