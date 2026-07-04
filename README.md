
&&se instal# Bergman Athlete Hub

This is a Next.js application for Bergman triathlon and duathlon participants, designed to track race performance, view rankings, and manage athletic profiles. It is being developed with the App Prototyper in Firebase Studio.

To get started, explore the athlete and club dashboards, and view the public rankings.

## Email provider: BergTechno API

This project now uses BergTechno API for email delivery.

- Existing template numbers/IDs remain unchanged.
- The legacy template field `brevoTemplateId` is still used as the provider template ID for backward compatibility.
- Only the provider transport layer has changed.

### Environment variables

Configure these on the server runtime:

- `BERGTECHNO_EMAIL_API_BASE_URL` (required)
- `BERGTECHNO_EMAIL_API_KEY` (required)
- `BERGTECHNO_EMAIL_API_KEY_HEADER` (optional, default: `x-api-key`)
- `BERGTECHNO_EMAIL_TEMPLATE_SEND_PATH` (optional, default: `/email/send-template`)
- `BERGTECHNO_EMAIL_RAW_SEND_PATH` (optional, default: `/email/send`)
- `BERGTECHNO_SENDER_EMAIL` (optional)
- `BERGTECHNO_SENDER_NAME` (optional)
- `BERGTECHNO_EMAIL_TIMEOUT_MS` (optional, default: `15000`)

Supported alias env keys: `BERGTECNO_*` (without the second "h").

### Bergtecno API reference

- Live docs: https://bergtecno.com/api/docs
- Base: https://bergtecno.com
- API: https://bergtecno.com/api
- Health: https://bergtecno.com/health

Default endpoint paths used by this app:

- Template send path: `/email/send-template`
- Raw send path: `/email/send`

Authentication header options:

- `X-API-Key: <key>` (default)
- `Authorization: Bearer <key>` (supported by setting `BERGTECHNO_EMAIL_API_KEY_HEADER=Authorization`)

### Admin configuration

In Admin → Templates, use the new **Integration** tab to configure BergTechno API settings:

- API base URL
- API key
- API key header
- sender email/name
- template/raw send paths
- timeout

Template numbering and all template-triggering business logic remain exactly the same.

### Template parameter rendering (important)

For maximum compatibility, the app sends template variables in both **flat** and **nested** forms.

If your template engine supports Liquid-style placeholders, you can use either:

- `{{ otp }}`
- `{{ params.otp }}`

Both will resolve to the same value.

#### Recommended placeholders

- Name: `{{ params.name }}` or `{{ name }}`
- OTP: `{{ params.otp }}` or `{{ otp }}`
- Year: `{{ year }}`

#### Example (OTP template)

Hello {{ params.name | default: "Athlete" }},

Your OTP is: {{ params.otp }}

This code is valid for 5 minutes.

© {{ year }} Bergman Triathlon

#### Variables sent by the app (email template calls)

At send time, payload includes:

- `params`: object containing all template values
- flat keys mirrored at top-level (example: `otp`, `name`, `year`)
- aliases for compatibility (`variables`, `data`, `templateData`)

This is why both `{{ key }}` and `{{ params.key }}` patterns work.

### Parameter reference (grouped)

#### Email parameters

| Parameter |
|---|
| `EVENT_NAME` |
| `addTags` |
| `address` |
| `amount` |
| `athleteName` |
| `bib_number` |
| `bibno` |
| `booking_date` |
| `booking_id` |
| `category` |
| `changedticket` |
| `checkin_date` |
| `checkin_time` |
| `checkout_date` |
| `checkout_time` |
| `clubName` |
| `club_name` |
| `company_description` |
| `country` |
| `couponCode` |
| `courier_name` |
| `customer_name` |
| `date` |
| `day` |
| `deferred_event` |
| `email` |
| `emergency_contact` |
| `emergency_number` |
| `emergencynumber` |
| `event` |
| `eventName` |
| `event_date` |
| `event_link` |
| `event_name` |
| `event_venue` |
| `eventdate` |
| `eventname` |
| `expiry_date` |
| `from_category` |
| `fullName` |
| `invoice_number` |
| `items` |
| `location` |
| `lockerno` |
| `message` |
| `mobile` |
| `name` |
| `number` |
| `order_date` |
| `order_details_url` |
| `order_id` |
| `orderid` |
| `organizer_address` |
| `organizer_name` |
| `otp` |
| `owner_name` |
| `payment_method` |
| `phone` |
| `product_summary` |
| `quantity` |
| `rack` |
| `reason` |
| `redirectUrl` |
| `refund_date` |
| `refund_id` |
| `removalDate` |
| `removedBy` |
| `service_type` |
| `shipping_address` |
| `subject` |
| `support_email` |
| `ticket` |
| `ticketId` |
| `time` |
| `to_category` |
| `total_amount` |
| `tracking_id` |
| `tracking_url` |
| `venue` |

#### WhatsApp-focused parameters

| Parameter |
|---|
| `locker_number` |
| `rack_name` |

#### Optional aliases and runtime compatibility keys

| Key | Notes |
|---|---|
| `params` | Nested object root for placeholders like `{{ params.name }}` |
| flat keys | Top-level keys like `name`, `otp`, `event_name` |
| `variables` | Alias object for provider compatibility |
| `data` | Alias object for provider compatibility |
| `templateData` | Alias object for provider compatibility |
| `year` | Auto-added if not supplied |

#### Additional flow-specific parameters

These are used in specific actions outside the template seed list (for recap, Stripe invoice, feedback campaign, etc.):

`year`, `clubName`, `totalPoints`, `overallRank`, `athlete_count`, `event_count`, `points`, `position`, `rank_category`, `category_name`, `races_count`, `best_performance`, `discount`, `validity`, `currency`.

## ✅ Complete Parameter Rendering Implementation

Status: **Complete and deployed**.

All custom parameters sent via `variables` are rendered in templates across supported placeholder formats.

### Quick start

```bash
curl -X POST https://api.bergtecno.com/api/email/send \
	-H "Authorization: Bearer YOUR_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{
		"to": "recipient@example.com",
		"subject": "Welcome {{name}} - BIB {{bib}}",
		"html": "<h1>{{params.name}}</h1><p>BIB: {{params.bib}}</p>",
		"variables": {
			"name": "John Doe",
			"bib": "12345"
		}
	}'
```

Expected render:

- Subject → `Welcome John Doe - BIB 12345`
- HTML → `<h1>John Doe</h1><p>BIB: 12345</p>`

### Supported placeholder formats

- `{{name}}`
- `{{params.name}}`
- `{{contact.name}}`
- `{{params["name"]}}`
- `{{athlete.firstName}}`
- `{{firstName}}` (last-segment resolution from nested objects)
- Case-insensitive keys: `{{NAME}}`, `{{Name}}`
- snake/camel variations: `{{user_name}}` and `{{userName}}`
- Liquid-style defaults: `{{name | default: "Guest"}}`

### Rendering behavior summary

The renderer uses a compatibility-first flow:

1. Flatten nested variable objects.
2. Build a multi-key lookup map.
3. Parse and resolve `{{ ... }}` expressions.
4. Apply defaults when provided via filter.
5. Emit debug logs for resolution traceability.

### Testing

- Run integration tests/scripts (if configured in your worker repo).
- Manual test with cURL (above).
- Inspect worker logs for replacement traces.

### Implementation note

Application-side payload compatibility is already aligned: emails are sent with both nested and flat variable shapes so placeholders like `{{name}}`, `{{params.name}}`, `{{bib}}`, and `{{params.bib}}` resolve consistently.
