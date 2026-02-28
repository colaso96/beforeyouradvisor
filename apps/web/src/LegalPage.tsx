type LegalPageProps = {
  title: string;
  lastUpdated: string;
  sections: Array<{ heading: string; body: string[] }>;
};

function LegalPage({ title, lastUpdated, sections }: LegalPageProps) {
  return (
    <main className="auth-shell">
      <section className="panel panel-full legal-page">
        <p className="eyebrow">Before Your Advisor</p>
        <h1>{title}</h1>
        <p className="muted">Last updated: {lastUpdated}</p>
        <div className="legal-links">
          <a href="/">Back to app</a>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/terms-of-service">Terms of Service</a>
        </div>
        {sections.map((section) => (
          <article key={section.heading} className="legal-section">
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
      </section>
    </main>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="February 28, 2026"
      sections={[
        {
          heading: "What data we collect",
          body: [
            "We collect the minimum data needed to run the product, including your account email, uploaded financial statement data, and analysis outputs.",
            "We may also collect operational logs needed to keep the service reliable and secure.",
          ],
        },
        {
          heading: "How your data is used",
          body: [
            "Your data is used only to provide the features you request in Before Your Advisor, such as ingestion, classification, and reporting.",
            "We do not sell your data, rent your data, or use your data for advertising.",
            "We do not use your uploaded financial data to train generalized AI models.",
          ],
        },
        {
          heading: "Sharing and retention",
          body: [
            "We only share data with infrastructure providers that are required to operate the service, and only as necessary to deliver core functionality.",
            "Data is retained as long as your account remains active or as needed for security, legal, and compliance obligations.",
          ],
        },
        {
          heading: "Your controls",
          body: [
            "You can stop using the service at any time.",
            "If you need data deletion support, contact the service owner through official product support channels.",
          ],
        },
      ]}
    />
  );
}

export function TermsOfServicePage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="February 28, 2026"
      sections={[
        {
          heading: "Service nature and no CPA relationship",
          body: [
            "Before Your Advisor provides AI-assisted categorization and suggestions for informational purposes.",
            "The service is not a CPA, law firm, tax preparer, or financial advisor, and use of the service does not create a professional-client relationship.",
            "You are responsible for reviewing all outputs and consulting a qualified professional before filing taxes or making legal or financial decisions.",
          ],
        },
        {
          heading: "No guarantee of accuracy",
          body: [
            "AI-generated outputs may be incomplete, inaccurate, or outdated.",
            "You accept full responsibility for how you use any output, including deduction decisions, filings, and compliance actions.",
          ],
        },
        {
          heading: "Acceptable use",
          body: [
            "You agree not to misuse the service, attempt unauthorized access, interfere with operations, or upload content you do not have rights to process.",
          ],
        },
        {
          heading: "Limitation of liability",
          body: [
            "To the maximum extent permitted by law, the service is provided on an 'as is' and 'as available' basis without warranties of any kind.",
            "Before Your Advisor and its operators are not liable for indirect, incidental, consequential, special, exemplary, or punitive damages, or for lost profits, revenue, or data arising from your use of the service.",
          ],
        },
      ]}
    />
  );
}
