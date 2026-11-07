# ProWebLook for Zoho CRM & Zoho Bigin

Official Zoho Marketplace Extension (**Zoho Sigma / ZET Embedded Widget**) and **Deluge Workflow Custom Functions** for **Zoho CRM** and **Zoho Bigin**.

Verify **Email deliverability**, **Phone Carrier & VoIP line type**, **Silent WhatsApp registration (zero OTP sent)**, and **Caller ID (CNAM)** directly inside Zoho Leads, Contacts, Deals, and automated CRM pipelines.

- **Setup & Documentation:** https://proweblook.com/zoho
- **Get 50 Free Credits / Pool:** https://proweblook.com/auth/signup
- **Dedicated Zoho Endpoint:** `https://proweblook.com/api/v1/zoho/{get_balance,verify_email,validate_phone,check_whatsapp,caller_id}`

---

## 3 Ways to Use in Zoho

### Option 1 — Zoho Sigma / Developer Space Embedded Widget (Zero Code)
1. Download **`proweblook-zoho-sigma-widget-v1.0.0.zip`** from [GitHub Releases](https://github.com/dubeychandan996/proweblook-zoho/releases/latest) (or build locally with `npm run pack:zip`).
2. In **Zoho CRM**, go to **Setup → Developer Space → Widgets → Create New Widget** (Hosting: *Zoho*), upload `proweblook-zoho-sigma-widget-v1.0.0.zip`, or upload directly in [Zoho Sigma](https://sigma.zoho.com) as a Marketplace extension.
3. Set Organization Variable `proweblook.api_key` (or paste your API key inside the widget's **Credits & Key** tab).
4. Open any **Lead**, **Contact**, or **Deal** to run 1-click 4-signal verification and attach structured **Trust Score (`0–100`)** notes, or open the **ProWebLook Bulk Enrich** WebTab to batch-verify unverified CRM records.

### Option 2 — Zoho CRM Automated Workflow Rule (`deluge/verify_lead_workflow.dg`)
1. In **Zoho CRM**, navigate to **Setup → Automation → Workflow Rules → Create Rule** (`Module: Leads`, Trigger: *On Create*).
2. Add an **Instant Action → Function → Write your own**, map `leadId` to `Leads -> Lead Id`, and paste [`deluge/verify_lead_workflow.dg`](./deluge/verify_lead_workflow.dg).
3. Every inbound Lead is automatically screened across Email, Phone Carrier/VoIP, and Silent WhatsApp, with an `APPROVE` / `REVIEW` / `BLOCK` note attached immediately.

### Option 3 — Zoho Bigin Pipeline Automation (`deluge/bigin_contact_verify.dg`)
1. In **Zoho Bigin**, open **Settings → Workflows → Create Workflow** (`Module: Contacts`, Trigger: *Created*).
2. Add a **Custom Function** and paste [`deluge/bigin_contact_verify.dg`](./deluge/bigin_contact_verify.dg).

---

## Local Development & Verification

```bash
npm test
npm run validate
npm run pack:zip
```
