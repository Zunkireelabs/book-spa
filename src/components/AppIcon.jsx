import React from 'react';
import { HelpCircle } from 'lucide-react';
import iconRegistry from './iconRegistry';

// Icons come from an explicit generated registry rather than a `import * as
// LucideIcons` namespace import. The namespace form defeats tree-shaking, so
// all 5,293 lucide exports were being bundled for the 165 this app uses — about
// 1.1 MB of the old single-chunk build. Regenerate the registry with
// `node scripts/gen-icon-registry.mjs` after introducing a new icon name.
function Icon({
    name,
    size = 24,
    color = "currentColor",
    className = "",
    strokeWidth = 2,
    ...props
}) {
    const IconComponent = iconRegistry[name];

    if (!IconComponent) {
        return <HelpCircle size={size} color="gray" strokeWidth={strokeWidth} className={className} {...props} />;
    }

    return <IconComponent
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        className={className}
        {...props}
    />;
}
export default Icon;
