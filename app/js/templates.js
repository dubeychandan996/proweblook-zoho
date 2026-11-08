export const ZOHO_CRM_DELUGE_SNIPPET = `// Zoho CRM -> Setup -> Automation -> Workflow Rules -> Leads (On Create) -> Custom Function
// Arguments: leadId (int/string, mapped to Leads -> Lead Id)
void verifyLeadWithProweblook(string leadId)
{
\tapiKey = ifnull(zoho.crm.getOrgVariable("proweblook__api_key"), zoho.crm.getOrgVariable("proweblook.api_key"));
\tdefaultCountry = ifnull(zoho.crm.getOrgVariable("proweblook__default_country_code"),"IN");
\tlead = zoho.crm.getRecordById("Leads", leadId.toLong());
\temail = ifnull(lead.get("Email"),"").trim();
\tphone = ifnull(lead.get("Mobile"), ifnull(lead.get("Phone"),"")).trim();
\theaders = {"Authorization":"Bearer " + apiKey,"Content-Type":"application/json"};
\temailVerdict = "not_checked";
\tphoneVerdict = "not_checked";
\twaVerdict = "not_checked";
\tscore = 50;
\thardBlock = false;
\tif(email != "")
\t{
\t\teResp = invokeurl
\t\t[
\t\t\turl :"https://proweblook.com/api/v1/zoho/verify_email"
\t\t\ttype :POST
\t\t\tparameters:{"email":email}.toString()
\t\t\theaders:headers
\t\t];
\t\tif(eResp.get("ok") == true)
\t\t{
\t\t\temailVerdict = eResp.get("data").get("verdict");
\t\t\tif(emailVerdict == "deliverable") { score = score + 20; }
\t\t\telse if(emailVerdict == "undeliverable") { score = score - 35; hardBlock = true; }
\t\t}
\t}
\tif(phone != "")
\t{
\t\tpBody = Map();
\t\tpBody.put("phone_number", phone);
\t\tif(!phone.startsWith("+")) { pBody.put("country_code", defaultCountry); }
\t\tpResp = invokeurl
\t\t[
\t\t\turl :"https://proweblook.com/api/v1/zoho/validate_phone"
\t\t\ttype :POST
\t\t\tparameters:pBody.toString()
\t\t\theaders:headers
\t\t];
\t\tif(pResp.get("ok") == true)
\t\t{
\t\t\tpData = pResp.get("data");
\t\t\tphoneVerdict = pData.get("verdict");
\t\t\tif(phoneVerdict == "valid")
\t\t\t{
\t\t\t\tscore = score + 15;
\t\t\t\twaResp = invokeurl
\t\t\t\t[
\t\t\t\t\turl :"https://proweblook.com/api/v1/zoho/check_whatsapp"
\t\t\t\t\ttype :POST
\t\t\t\t\tparameters:{"phone_number":pData.get("phone_number")}.toString()
\t\t\t\t\theaders:headers
\t\t\t\t];
\t\t\t\tif(waResp.get("ok") == true)
\t\t\t\t{
\t\t\t\t\twaVerdict = waResp.get("data").get("verdict");
\t\t\t\t\tif(waVerdict == "on_whatsapp") { score = score + 15; }
\t\t\t\t\telse { score = score - 12; }
\t\t\t\t}
\t\t\t}
\t\t\telse if(phoneVerdict == "invalid") { score = score - 35; hardBlock = true; }
\t\t}
\t}
\tstatus = if(hardBlock || score < 35, "BLOCK", if(score >= 70, "APPROVE", "REVIEW"));
\tnoteMap = Map();
\tnoteMap.put("Parent_Id", leadId.toLong());
\tnoteMap.put("Note_Title", "ProWebLook " + status + " (" + score + "/100)");
\tnoteMap.put("Note_Content", "Email: " + emailVerdict + " | Phone: " + phoneVerdict + " | WhatsApp: " + waVerdict);
\tnoteMap.put("se_module", "Leads");
\tzoho.crm.createRecord("Notes", noteMap);
}`;

export const ZOHO_BIGIN_DELUGE_SNIPPET = `// Zoho Bigin -> Settings -> Workflows -> Contacts (On Create) -> Custom Function
// Arguments: contactId (string, mapped to Contacts -> Contact Id), apiKey (string)
void verifyBiginContact(string contactId, string apiKey)
{
\tcontact = zoho.bigin.getRecordById("Contacts", contactId.toLong());
\tdataRow = contact.get("data").get(0);
\temail = ifnull(dataRow.get("Email"),"").trim();
\tphone = ifnull(dataRow.get("Mobile"), ifnull(dataRow.get("Phone"),"")).trim();
\theaders = {"Authorization":"Bearer " + apiKey.trim(),"Content-Type":"application/json"};
\tsummary = List();
\tif(email != "")
\t{
\t\teResp = invokeurl
\t\t[
\t\t\turl :"https://proweblook.com/api/v1/zoho/verify_email"
\t\t\ttype :POST
\t\t\tparameters:{"email":email}.toString()
\t\t\theaders:headers
\t\t];
\t\tif(eResp.get("ok") == true) { summary.add("Email: " + eResp.get("data").get("verdict")); }
\t}
\tif(phone != "")
\t{
\t\tpBody = if(phone.startsWith("+"), {"phone_number":phone}, {"phone_number":phone,"country_code":"IN"});
\t\twaResp = invokeurl
\t\t[
\t\t\turl :"https://proweblook.com/api/v1/zoho/check_whatsapp"
\t\t\ttype :POST
\t\t\tparameters:pBody.toString()
\t\t\theaders:headers
\t\t];
\t\tif(waResp.get("ok") == true) { summary.add("WhatsApp: " + waResp.get("data").get("verdict")); }
\t}
\tif(summary.size() > 0)
\t{
\t\tupd = Map();
\t\tupd.put("Description", summary.toString(" | "));
\t\tzoho.bigin.updateRecord("Contacts", contactId, upd);
\t}
}`;
