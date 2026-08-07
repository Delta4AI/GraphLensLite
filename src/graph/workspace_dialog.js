/**
 * The "Create New Workspace" dialog: a name, then clone-the-current-workspace
 * vs a layout template, then that template's own knobs.
 *
 * Lives beside the layout manager that opens it — as a ~170-line app-specific
 * dialog inside the generic Popup utility it made that utility carry a feature.
 */
import { Popup } from '../utilities/popup.js';

/**
 * @param {object} layoutInternals  DEFAULTS.LAYOUT_INTERNALS: per-template knobs
 * @returns {Promise<{name: string, mode: string, templateType: string|null,
 *   internals: object|null}|null>} null when the user cancels
 */
function openWorkspaceCreationDialog(layoutInternals) {
  return new Promise((resolve) => {
    const container = document.createElement('div');

    // Name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'p-prompt';
    nameInput.placeholder = 'Enter workspace name...';
    nameInput.style.width = '100%';
    nameInput.style.marginBottom = '20px';
    nameInput.style.padding = '8px';
    container.appendChild(nameInput);

    // Mode selection
    const modeContainer = document.createElement('div');

    // Clone option
    const cloneDiv = document.createElement('div');
    cloneDiv.style.marginBottom = '10px';

    const cloneRadio = document.createElement('input');
    cloneRadio.type = 'radio';
    cloneRadio.name = 'layout-mode';
    cloneRadio.value = 'clone';
    cloneRadio.checked = true;
    cloneRadio.id = 'mode-clone';

    const cloneLabel = document.createElement('label');
    cloneLabel.htmlFor = 'mode-clone';
    cloneLabel.textContent = ' Clone Current Workspace';
    cloneLabel.style.fontWeight = 'bold';

    const cloneDesc = document.createElement('p');
    cloneDesc.textContent = 'Copies all settings: positions, filters, query, and bubble groups';
    cloneDesc.style.fontSize = '12px';
    cloneDesc.style.color = 'var(--text-muted)';
    cloneDesc.style.marginLeft = '20px';
    cloneDesc.style.marginTop = '5px';
    cloneDesc.style.marginBottom = '0';

    cloneDiv.appendChild(cloneRadio);
    cloneDiv.appendChild(cloneLabel);
    cloneDiv.appendChild(cloneDesc);
    modeContainer.appendChild(cloneDiv);

    // Template option
    const templateDiv = document.createElement('div');
    templateDiv.style.marginBottom = '10px';

    const templateRadio = document.createElement('input');
    templateRadio.type = 'radio';
    templateRadio.name = 'layout-mode';
    templateRadio.value = 'template';
    templateRadio.id = 'mode-template';

    const templateLabel = document.createElement('label');
    templateLabel.htmlFor = 'mode-template';
    templateLabel.textContent = ' Create from Template';
    templateLabel.style.fontWeight = 'bold';

    // Template dropdown (inline, initially hidden)
    const dropdown = document.createElement('select');
    dropdown.id = 'template-type-select';
    dropdown.className = 'p-prompt';
    dropdown.style.width = '150px';
    dropdown.style.marginLeft = '10px';
    dropdown.style.display = 'none';

    // Populate dropdown with layout types
    for (const key of Object.keys(layoutInternals)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
      dropdown.appendChild(option);
    }

    const templateDesc = document.createElement('p');
    templateDesc.textContent = 'Starts fresh with selected layout algorithm and default filters';
    templateDesc.style.fontSize = '12px';
    templateDesc.style.color = 'var(--text-muted)';
    templateDesc.style.marginLeft = '20px';
    templateDesc.style.marginTop = '5px';
    templateDesc.style.marginBottom = '10px';

    templateDiv.appendChild(templateRadio);
    templateDiv.appendChild(templateLabel);
    templateDiv.appendChild(dropdown);
    templateDiv.appendChild(templateDesc);
    modeContainer.appendChild(templateDiv);

    container.appendChild(modeContainer);

    // Show/hide dropdown based on radio selection
    const updateDropdownVisibility = () => {
      dropdown.style.display = templateRadio.checked ? 'inline-block' : 'none';
    };

    cloneRadio.addEventListener('change', updateDropdownVisibility);
    templateRadio.addEventListener('change', updateDropdownVisibility);

    // Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'p-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'p-button p-button-secondary';

    const createBtn = document.createElement('button');
    createBtn.textContent = 'Create';
    createBtn.className = 'p-button p-button-primary';
    createBtn.style.backgroundColor = '#015C0C';

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(createBtn);
    container.appendChild(buttonContainer);

    let isResolved = false;

    const popup = new Popup(container, {
      title: 'Create New Workspace',
      width: '400px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!isResolved) {
          resolve(null);
        }
      }
    });

    const handleCreate = () => {
      const name = nameInput.value.trim();
      if (!name) {
        alert('Please enter a name for the layout');
        return;
      }

      isResolved = true;
      popup.close();

      const mode = cloneRadio.checked ? 'clone' : 'template';
      const result = {
        name: name,
        mode: mode,
        templateType: mode === 'template' ? dropdown.value : null
      };

      resolve(result);
    };

    createBtn.addEventListener('click', handleCreate);
    cancelBtn.addEventListener('click', () => {
      isResolved = true;
      popup.close();
      resolve(null);
    });

    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleCreate();
      }
    });

    setTimeout(() => nameInput.focus(), 0);
  });
}

export { openWorkspaceCreationDialog };
