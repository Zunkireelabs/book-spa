import React, { forwardRef, useId } from "react";

const Input = forwardRef(({ className = "", type = "text", label, id: externalId, error, ...props }, ref) => {
    const autoId = useId();
    const inputId = externalId || (label ? autoId : undefined);

    // CheckBox-specific styles
    if (type === "checkbox") {
        const checkboxClass =
            "h-4 w-4 mx-1 rounded border border-input bg-background text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

        return (
            <>
                {label && (
                    <label htmlFor={inputId} className="block font-body font-body-medium text-sm text-text-primary mb-1">
                        {label}
                    </label>
                )}
                <input
                    id={inputId}
                    type="checkbox"
                    className={checkboxClass}
                    ref={ref}
                    {...props}
                />
            </>
        );
    }

    // Radio button-specific styles
    if (type === "radio") {
        const radioClass =
            "h-4 w-4 mx-1 rounded-full border border-input bg-background text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

        return (
            <>
                {label && (
                    <label htmlFor={inputId} className="block font-body font-body-medium text-sm text-text-primary mb-1">
                        {label}
                    </label>
                )}
                <input
                    id={inputId}
                    type="radio"
                    className={radioClass + " " + className}
                    ref={ref}
                    {...props}
                />
            </>
        );
    }

    const baseClass =
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

    return (
        <div>
            {label && (
                <label htmlFor={inputId} className="block font-body font-body-medium text-sm text-text-primary mb-1">
                    {label}
                </label>
            )}
            <input
                id={inputId}
                type={type}
                className={baseClass + " " + className}
                ref={ref}
                aria-invalid={error ? "true" : undefined}
                {...props}
            />
            {error && (
                <p className="font-caption font-caption-normal text-xs text-error mt-1">{error}</p>
            )}
        </div>
    );
});

Input.displayName = "Input";

export default Input;
