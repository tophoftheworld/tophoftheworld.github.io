/** Keep in sync with mmf-merchant-registration/js/config.js */
const EVENT = {
  finalPaymentDue: "August 6, 2026",
};

const SITE_URL = process.env.MMF_SITE_URL || "https://mmf-info.web.app";

const PAYMENT_DETAILS = {
  hints: {
    bank: "For bank transfer / cash deposit:",
    ewallet: "For e-wallet:",
  },
  accounts: [
    {
      type: "bank",
      label: "BDO",
      accountName: "MATCHANESE INC",
      accountNumber: "000251640035",
    },
    {
      type: "bank",
      label: "Unionbank",
      accountName: "Cristopher David",
      accountNumber: "109420972821",
    },
    {
      type: "bank",
      label: "BPI",
      accountName: "Cristopher David",
      accountNumber: "0829677495",
    },
    {
      type: "ewallet",
      label: "GCash",
      accountName: "Cristopher David",
      accountNumber: "09496471857",
      qrImage: "images/qr/gcash.png",
    },
    {
      type: "ewallet",
      label: "Maya",
      accountName: "Cristopher David",
      accountNumber: "09496471857",
      qrImage: "images/qr/maya.png",
    },
    {
      type: "ewallet",
      label: "GoTyme",
      accountName: "Cristopher David",
      accountNumber: "016694689311",
      qrImage: "images/qr/gotyme.png",
    },
  ],
  card: {
    note: "You’ll be redirected to PayPal when you submit this form.",
  },
};

/**
 * Temporary: set to a number (e.g. 28) to test partial PayPal payments.
 * Set to `null` before go-live so minimum due = 50% downpayment (PHP 28,000).
 */
const PAYPAL_TEST_MINIMUM_DUE = 28;

function publicAssetUrl(relativePath) {
  return `${String(SITE_URL).replace(/\/$/, "")}/${String(relativePath || "").replace(/^\//, "")}`;
}

module.exports = { EVENT, SITE_URL, PAYMENT_DETAILS, PAYPAL_TEST_MINIMUM_DUE, publicAssetUrl };
