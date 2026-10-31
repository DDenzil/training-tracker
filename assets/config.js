// =====================================================================
//  Online Training Tracker — settings
//  Fill in the two Supabase values (Project Settings → API).
//  The anon / publishable key is designed to be public: all protection
//  comes from the database rules in supabase/schema.sql.
// =====================================================================
window.OTT_CONFIG = {
  SUPABASE_URL: 'https://toqzbnmdkptucrwdqtwu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_uJ59XXbPoNXUcXxDHoYPzA_nXN0EU2i',

  APP_NAME: 'Training Tracker',
  CONTACT_LINE: 'Contact the Safety Training Team to report an error.',

  // Shown on the Privacy Policy and Terms of Service pages
  ORG_NAME: 'Al Dana Tower',
  CONTACT_EMAIL: 'NSharma@home.com',
  POLICY_DATE: '31 October 2026',

  // Must match the "+ 30" in v_training_status (schema.sql)
  DUE_SOON_DAYS: 30
};
