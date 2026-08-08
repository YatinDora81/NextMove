"use client"

import { StepHeader, SubSection, TextField, type StepProps } from "@/app/onboarding/steps/fields"

export function AboutYouStep({ draft, errors, patch, onBlurField }: StepProps) {
    const { personal } = draft

    const setPersonal = (next: Partial<typeof personal>) => {
        patch({ personal: { ...personal, ...next } })
    }

    const setAddress = (next: Partial<typeof personal.address>) => {
        patch({ personal: { ...personal, address: { ...personal.address, ...next } } })
    }

    return (
        <div className="flex flex-col gap-8">
            <StepHeader
                title="About you"
                description="The block at the top of every application form. Filled in once here, typed never again."
            />

            <SubSection title="Contact" hint="We prefilled what your NextMove account already knew.">
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                        label="First name"
                        value={personal.firstName}
                        autoComplete="given-name"
                        error={errors["personal.firstName"]}
                        onChange={(value) => setPersonal({ firstName: value })}
                        onBlur={() => onBlurField("personal.firstName", personal.firstName)}
                    />
                    <TextField
                        label="Last name"
                        value={personal.lastName}
                        autoComplete="family-name"
                        error={errors["personal.lastName"]}
                        onChange={(value) => setPersonal({ lastName: value })}
                        onBlur={() => onBlurField("personal.lastName", personal.lastName)}
                    />
                    <TextField
                        label="Email"
                        type="email"
                        inputMode="email"
                        value={personal.email}
                        autoComplete="email"
                        placeholder="you@example.com"
                        error={errors["personal.email"]}
                        onChange={(value) => setPersonal({ email: value })}
                        onBlur={() => onBlurField("personal.email", personal.email)}
                    />
                    <TextField
                        label="Phone"
                        type="tel"
                        inputMode="tel"
                        value={personal.phone}
                        autoComplete="tel"
                        placeholder="+1 555 010 0199"
                        hint="Include the country code — some forms reject numbers without one."
                        onChange={(value) => setPersonal({ phone: value })}
                    />
                </div>
            </SubSection>

            <SubSection
                title="Where you live"
                hint="Used for the address block, and for the “are you local to this office?” questions."
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                        label="Address line 1"
                        value={personal.address.line1}
                        autoComplete="address-line1"
                        className="sm:col-span-2"
                        onChange={(value) => setAddress({ line1: value })}
                    />
                    <TextField
                        label="Address line 2"
                        value={personal.address.line2}
                        autoComplete="address-line2"
                        placeholder="Apartment, suite, floor"
                        className="sm:col-span-2"
                        onChange={(value) => setAddress({ line2: value })}
                    />
                    <TextField
                        label="City"
                        value={personal.address.city}
                        autoComplete="address-level2"
                        onChange={(value) => setAddress({ city: value })}
                    />
                    <TextField
                        label="State or region"
                        value={personal.address.state}
                        autoComplete="address-level1"
                        onChange={(value) => setAddress({ state: value })}
                    />
                    <TextField
                        label="Postal code"
                        value={personal.address.postalCode}
                        autoComplete="postal-code"
                        onChange={(value) => setAddress({ postalCode: value })}
                    />
                    <TextField
                        label="Country"
                        value={personal.address.country}
                        autoComplete="country-name"
                        onChange={(value) => setAddress({ country: value })}
                    />
                </div>
            </SubSection>
        </div>
    )
}
