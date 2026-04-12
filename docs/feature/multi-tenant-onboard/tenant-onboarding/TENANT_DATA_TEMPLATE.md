# Tenant Data Template

Use this template to collect all required information before onboarding a new tenant.

---

## Organization Information

| Field | Value | Required |
|-------|-------|----------|
| **Organization Name** | | Yes |
| **Code** (3 letters, unique) | | Yes |
| **Slug** (URL-friendly) | | Yes |
| **Owner Email** | | Yes |
| **Timezone** | Asia/Kathmandu | Yes |
| **Currency** | NPR | Yes |

### Example

```
Organization Name: Serenity Wellness Spa
Code: SWS
Slug: serenity-wellness
Owner Email: admin@serenitywellness.com
Timezone: Asia/Kathmandu
Currency: NPR
```

---

## Branch Information

| Field | Value | Required |
|-------|-------|----------|
| **Branch Name** | | Yes |
| **Address** | | No |
| **Phone** | | No |
| **Opening Time** | 09:00 | Yes |
| **Closing Time** | 21:00 | Yes |

### Example

```
Branch Name: Serenity Wellness - Thamel
Address: 123 Thamel Street, Kathmandu
Phone: +977-1-4123456
Opening Time: 09:00
Closing Time: 21:00
```

---

## Rooms

List all rooms/treatment areas:

| Room Name | Active |
|-----------|--------|
| | Yes/No |
| | Yes/No |
| | Yes/No |

### Example

```
1. VIP Suite 1 - Active
2. VIP Suite 2 - Active
3. Couple Room - Active
4. Treatment Room 1 - Active
5. Treatment Room 2 - Active
6. Facial Room - Active
```

---

## Therapists

| Name | Gender | Specialties | Active |
|------|--------|-------------|--------|
| | Male/Female | | Yes/No |
| | Male/Female | | Yes/No |

### Example

```
1. Maya Tamang - Female - Massage, Thai - Active
2. Sita Gurung - Female - Facial, Waxing - Active
3. Ram Thapa - Male - Massage, Deep Tissue - Active
```

---

## Services

### Option A: Use Template Services

Copy all 194 services from Nuad Thai Spa template? **Yes / No**

If Yes, services will be copied with same names, durations, and prices.

### Option B: Custom Services

If providing custom services, use this format:

| Name | Duration (min) | Price (NPR) | Category | Active |
|------|----------------|-------------|----------|--------|
| | | | | Yes/No |

**Categories available:**
- Spa
- Salon
- Facial
- Wellness
- Waxing
- Threading
- Hair Color
- Hair Treatment
- Nail
- Packages
- Other

### Example

```
1. Swedish Massage - 60 min - NPR 3500 - Spa - Active
2. Deep Tissue Massage - 90 min - NPR 5000 - Spa - Active
3. Basic Facial - 45 min - NPR 2500 - Facial - Active
```

---

## Admin User

| Field | Value | Required |
|-------|-------|----------|
| **Full Name** | | Yes |
| **Email** | | Yes |
| **Role** | admin | Yes |

### Example

```
Full Name: Ramesh Sharma
Email: ramesh@serenitywellness.com
Role: admin
```

---

## Checklist Before Onboarding

- [ ] Organization name and code are unique
- [ ] Owner email is valid and accessible
- [ ] Branch information is complete
- [ ] Room list is finalized
- [ ] Therapist list is finalized
- [ ] Service decision made (template or custom)
- [ ] Admin user email is ready for Auth signup

---

## Data Import Format (CSV)

### Rooms CSV

```csv
name,is_active
VIP Suite 1,true
VIP Suite 2,true
Treatment Room 1,true
```

### Therapists CSV

```csv
name,gender,specialties,is_active
Maya Tamang,Female,"Massage,Thai",true
Sita Gurung,Female,"Facial,Waxing",true
```

### Services CSV

```csv
name,duration_minutes,price_npr,category,is_active
Swedish Massage,60,3500,Spa,true
Deep Tissue,90,5000,Spa,true
```

---

## Notes

- All IDs are auto-generated UUIDs
- Timestamps use Nepal timezone (Asia/Kathmandu)
- Prices are in NPR (Nepalese Rupees)
- Service categories must match existing enum values
