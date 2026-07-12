import { useEffect, useRef, useState } from 'react';
import { FileFormatsGuide } from './FileFormatsGuide';
import { useBackdropDismiss } from './useBackdropDismiss';

type WelcomeDialogProps = {
  onClose: () => void;
};

export function WelcomeDialog({ onClose }: WelcomeDialogProps) {
  const [page, setPage] = useState<1 | 2 | 3 | 4>(1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    // Focus dialog container for accessibility
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop welcome-dialog-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section
        ref={dialogRef}
        className="welcome-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to RPGraph Studio"
        tabIndex={-1}
      >
        {/* Close Button in Header */}
        <button
          type="button"
          className="welcome-close-x"
          onClick={onClose}
          aria-label="Close onboarding guide"
        >
          &times;
        </button>

        <div className="welcome-dialog-content">
          {page === 1 ? (
            <FileFormatsGuide />
          ) : page === 2 ? (
            <div className="welcome-page-colors">
              <header className="welcome-header">
                <h2>Node Run Colors & Execution States</h2>
                <p>RPGraph Studio colors nodes and outgoing wires by their current execution state during each turn.</p>
              </header>

              {/* High-Fidelity Mini Graph Illustration */}
              <div className="mini-graph-container">
                <div className="mini-graph-canvas">
                  {/* SVG Wires Layer */}
                  <svg className="mini-graph-svg" xmlns="http://www.w3.org/2000/svg">
                    {/* Wire 1: Orange prepared (Node A -> Node B) */}
                    <path
                      className="mini-wire orange-wire"
                      d="M 174 55 C 205 55, 205 115, 236 115"
                      fill="none"
                    />
                    {/* Wire 2: Green completed (Node B -> Node C) */}
                    <path
                      className="mini-wire green-wire"
                      d="M 390 115 C 425 115, 425 65, 460 65"
                      fill="none"
                    />
                  </svg>

                  {/* Node A: Prepared (Orange) */}
                  <div className="mini-node prepared-node" style={{ left: '20px', top: '25px' }}>
                    <div className="mini-node-header-stripe"></div>
                    <div className="mini-node-body">
                      <div className="mini-node-title">Chat History</div>
                      <div className="mini-node-subtitle">Prepared</div>
                    </div>
                    {/* Output port */}
                    <div className="mini-node-port output-port" style={{ right: '-5px', top: '30px' }}></div>
                  </div>

                  {/* Node B: Completed (Green) */}
                  <div className="mini-node complete-node" style={{ left: '240px', top: '85px' }}>
                    <div className="mini-node-header-stripe"></div>
                    <div className="mini-node-body">
                      <div className="mini-node-title">User Input</div>
                      <div className="mini-node-subtitle">Completed</div>
                    </div>
                    {/* Input port */}
                    <div className="mini-node-port input-port" style={{ left: '-5px', top: '30px' }}></div>
                    {/* Output port */}
                    <div className="mini-node-port output-port" style={{ right: '-5px', top: '30px' }}></div>
                  </div>

                  {/* Node C: Active (Blue) */}
                  <div className="mini-node active-node" style={{ left: '460px', top: '35px' }}>
                    <div className="mini-node-header-stripe"></div>
                    <div className="mini-node-body">
                      <div className="mini-node-title">LLM Prompt</div>
                      <div className="mini-node-subtitle">Running</div>
                    </div>
                    {/* Input port */}
                    <div className="mini-node-port input-port" style={{ left: '-5px', top: '30px' }}></div>
                  </div>
                </div>
              </div>

              {/* Status Legend & Info */}
              <div className="welcome-states-legend">
                <div className="legend-item active">
                  <span className="legend-indicator"></span>
                  <div className="legend-text">
                    <strong>Fresh / Active (Blue)</strong>
                    <span>Node is fresh, not yet completed, or actively processing on the visible response path. Active response-path nodes briefly pop upward in blue.</span>
                  </div>
                </div>
                <div className="legend-item complete">
                  <span className="legend-indicator"></span>
                  <div className="legend-text">
                    <strong>Completed (Green)</strong>
                    <span>Node successfully completed execution for the current turn. Its outgoing wires turn green.</span>
                  </div>
                </div>
                <div className="legend-item prepared">
                  <span className="legend-indicator"></span>
                  <div className="legend-text">
                    <strong>Prepared (Orange)</strong>
                    <span>Node prepared state for the next turn after chat output was delivered. Prepared nodes briefly pop upward in orange, stay orange, and become completed when the next turn starts. LLM-based preparation runs only for nodes that have <strong>"Prepare next turn when reached"</strong> enabled. Optional preparation work includes:</span>
                    <ul className="prepared-bullets">
                      <li><strong>Event Manager</strong>: Extracts and schedules upcoming or conditional events from the dialogue (notes them down; does not trigger them).</li>
                      <li><strong>Character Stats</strong>: Initializes or updates personality/relationship attributes (0 to 100) based on the latest messages.</li>
                      <li><strong>Time & History</strong>: Increments active tracking variables and appends messages to history.</li>
                      <li><strong>Context Compression</strong>: Compresses prompt memory in the background.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : page === 3 ? (
            <div className="welcome-page-assistant">
              <header className="welcome-header">
                <h2>Built-in AI Assistant</h2>
                <p>Ask questions, debug runtime errors, and inspect node source code directly in the editor.</p>
              </header>

              <div className="welcome-assistant-columns">
                {/* Left: Chat Mockup */}
                <div className="welcome-assistant-mockup">
                  <div className="mock-chat-header">
                    <div className="mock-chat-title">
                      <strong>AI Assistant</strong>
                    </div>
                  </div>

                  <div className="mock-chat-messages">
                    <div className="mock-message user">
                      <div className="mock-avatar">U</div>
                      <div className="mock-bubble">How many events are currently in the Event Manager?</div>
                    </div>
                    <div className="mock-message context">
                      <div className="mock-avatar ctx">CTX</div>
                      <div className="mock-bubble">
                        <strong>Loaded node context: Event Manager</strong>
                        <span>Code ~5.1k tokens | Details ~420 tokens</span>
                      </div>
                    </div>
                    <div className="mock-message assistant">
                      <div className="mock-avatar ai">AI</div>
                      <div className="mock-bubble">
                        There are currently 3 active events scheduled in the node's state.
                      </div>
                    </div>
                    <div className="mock-message user">
                      <div className="mock-avatar">U</div>
                      <div className="mock-bubble">Which event was recently added?</div>
                    </div>
                    <div className="mock-message assistant">
                      <div className="mock-avatar ai">AI</div>
                      <div className="mock-bubble">
                        The event "Dinner with Sarah at 8 PM" was added in the last turn.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Info Cards */}
                <div className="welcome-assistant-info">
                  <div className="welcome-assistant-card">
                    <h3>Two Chat Modes</h3>
                    <div className="mode-entry">
                      <strong>Workflow Mode</strong>
                      <p>Press <kbd className="kbd-shortcut">F1</kbd> with no node selected (or click the top bar button) to analyze the overall graph and trace data flow.</p>
                    </div>
                    <div className="mode-entry">
                      <strong>Node Mode</strong>
                      <p>Select any node and press <kbd className="kbd-shortcut">F1</kbd> to inspect its raw source code, variables, and warnings.</p>
                    </div>
                  </div>

                  <div className="welcome-assistant-card">
                    <h3>Smart Capabilities</h3>
                    <ul className="capabilities-bullets">
                      <li><strong>Live Context</strong>: Reads node variables, state JSON, and system logs.</li>
                      <li><strong>Lazy Loading</strong>: Automatically requests and loads other node details when mentioned.</li>
                      <li><strong>Debug Snapshots</strong>: Ask what snapshots it can load to inspect recent runs, messages, routing, events, and logs for better error analysis.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="welcome-page-storybook">
              <header className="welcome-header">
                <h2>RP Storybook & Character Import</h2>
                <p>Define rich scenarios, import SillyTavern character sheets, and craft settings interactively with an AI assistant.</p>
              </header>

              <div className="welcome-storybook-columns">
                {/* Left: Chat Mockup from User Image */}
                <div className="welcome-assistant-mockup">
                  <div className="mock-chat-header">
                    <div className="mock-chat-title">
                      <strong>AI Storybook Assistant</strong>
                    </div>
                  </div>

                  <div className="mock-chat-messages">
                    <div className="mock-message user">
                      <div className="mock-avatar">U</div>
                      <div className="mock-bubble">Import SillyTavern character: SaraR_spec_v2.json</div>
                    </div>
                    <div className="mock-message assistant">
                      <div className="mock-avatar ai">AI</div>
                      <div className="mock-bubble">
                        <strong>import player + scenario.openingSituation + title:</strong> I have imported Sarah R. as the player character. Her details from the SillyTavern card, including her background as a novelist and her shy personality, have been mapped to the storybook fields.
                      </div>
                    </div>
                    <div className="mock-message user">
                      <div className="mock-avatar">U</div>
                      <div className="mock-bubble">Make the current situation. The character is driving home with car.</div>
                    </div>
                    <div className="mock-message assistant">
                      <div className="mock-avatar ai">AI</div>
                      <div className="mock-bubble">
                        <strong>edit scenario.currentSituation:</strong> I've updated the current situation to reflect Sarah R. driving home.
                      </div>
                    </div>
                    <div className="mock-message user">
                      <div className="mock-avatar">U</div>
                      <div className="mock-bubble">add a second actor. His name is Leo.</div>
                    </div>
                    <div className="mock-message assistant">
                      <div className="mock-avatar ai">AI</div>
                      <div className="mock-bubble">
                        <strong>edit actors:</strong> I've added Leo as a new actor to the storybook.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Info Cards */}
                <div className="welcome-storybook-info">
                  <div className="welcome-storybook-card">
                    <h3>Interactive Authoring</h3>
                    <div className="storybook-entry">
                      <strong>AA Storybook Assistent</strong>
                      <p>Open "Create Storybook" on the <strong>RP Storybook V2</strong> node. Chat in natural language to design settings, player specs, or NPC characters.</p>
                    </div>
                  </div>

                  <div className="welcome-storybook-card">
                    <h3>Flexible Imports</h3>
                    <div className="storybook-entry">
                      <strong>SillyTavern V2 Cards</strong>
                      <p>Import existing character sheets directly into Player or NPC actor slots. The assistant handles all key-field mappings.</p>
                    </div>
                    <div className="storybook-entry">
                      <strong>Opening History</strong>
                      <p>Capture your current active conversation and embed it directly into the storybook to start future runs from the same point.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer controls */}
        <footer className="welcome-footer">
          {/* Indicators */}
          <div className="welcome-indicators" role="tablist" aria-label="Welcome screen pages">
            <button
              type="button"
              className={`indicator-dot ${page === 1 ? 'active' : ''}`}
              role="tab"
              aria-selected={page === 1}
              aria-label="File Formats page"
              onClick={() => setPage(1)}
            />
            <button
              type="button"
              className={`indicator-dot ${page === 2 ? 'active' : ''}`}
              role="tab"
              aria-selected={page === 2}
              aria-label="Node Run Colors page"
              onClick={() => setPage(2)}
            />
            <button
              type="button"
              className={`indicator-dot ${page === 3 ? 'active' : ''}`}
              role="tab"
              aria-selected={page === 3}
              aria-label="Assistant page"
              onClick={() => setPage(3)}
            />
            <button
              type="button"
              className={`indicator-dot ${page === 4 ? 'active' : ''}`}
              role="tab"
              aria-selected={page === 4}
              aria-label="Storybook page"
              onClick={() => setPage(4)}
            />
          </div>

          {/* Action buttons */}
          <div className="welcome-actions">
            {page === 1 ? (
              <button
                type="button"
                className="welcome-btn primary-btn"
                onClick={() => setPage(2)}
              >
                Next
              </button>
            ) : page === 2 ? (
              <>
                <button
                  type="button"
                  className="welcome-btn outline-btn"
                  onClick={() => setPage(1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="welcome-btn primary-btn"
                  onClick={() => setPage(3)}
                >
                  Next
                </button>
              </>
            ) : page === 3 ? (
              <>
                <button
                  type="button"
                  className="welcome-btn outline-btn"
                  onClick={() => setPage(2)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="welcome-btn primary-btn"
                  onClick={() => setPage(4)}
                >
                  Next
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="welcome-btn outline-btn"
                  onClick={() => setPage(3)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="welcome-btn primary-btn"
                  onClick={onClose}
                >
                  Done
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
