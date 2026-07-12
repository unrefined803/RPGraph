export function FileFormatsGuide() {
  return (
    <div className="welcome-page-formats">
      <header className="welcome-header">
        <h2>RPGraph Files & Storage Formats</h2>
        <p>Understand how complete RP saves, reusable workflow files, standalone Storybooks, and Character Cards are stored and loaded.</p>
      </header>

      <div className="format-node rp-save-format">
        <div className="format-node-header">
          <span className="format-node-badge">RP Save Format</span>
          <strong>RP Save (.json)</strong>
        </div>
        <div className="format-node-body">
          <p className="format-description">Stores one playable session as an embedded workflow snapshot plus timeline, entities, UI state, and current runtime state.</p>

          <div className="save-contents-split">
            <div className="format-node workflow-format">
              <div className="format-node-header">
                <span className="format-node-badge">Workflow File Format</span>
                <strong>Workflow File (.json)</strong>
              </div>
              <div className="format-node-body">
                <p className="format-description">Defines a reusable graph blueprint: viewport, nodes, connections, and persisted node configuration. RP saves embed a separate snapshot shape inside the RP Save Format.</p>

                <div className="format-node storybook-format">
                  <div className="format-node-header">
                    <span className="format-node-badge">Node Data</span>
                    <strong>RP Storybook (.json)</strong>
                  </div>
                  <div className="format-node-body">
                    <p className="format-description">Storybook content is embedded in RP Storybook nodes, or saved separately as a Storybook file.</p>

                    <div className="format-node opening-history-format">
                      <div className="format-node-header">
                        <span className="format-node-badge">Storybook Field</span>
                        <strong>Opening History</strong>
                      </div>
                      <div className="format-node-body">
                        <p className="format-description">Optional starter messages and events that are copied into a new chat when the workflow starts.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="format-node chat-history-format">
              <div className="format-node-header">
                <span className="format-node-badge">RP Save Data</span>
                <strong>Timeline & Runtime</strong>
              </div>
              <div className="format-node-body">
                <p className="format-description">Stores numbered turns, messages, opening messages, phone state, event entities, checkpoints, and the current runtime snapshot.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="formats-info-row">
        <div className="info-card">
          <h4>Nesting & Load Flexibility</h4>
          <p>Storybooks can be opened from <strong>Files</strong>. Character Cards use their own <strong>Characters</strong> picker backed by the local <strong>characters</strong> folder; its Open File action can browse elsewhere.</p>
        </div>
        <div className="info-card">
          <h4>Encryption & Safety</h4>
          <p>Workflows, RP saves, Storybooks, and Character Cards can be saved as readable <strong>Plain JSON</strong> or encrypted with a password/PIN. Encrypted Character Cards reveal only their character name and format version as character metadata.</p>
        </div>
      </div>
    </div>
  );
}
