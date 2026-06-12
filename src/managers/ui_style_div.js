import {StaticUtilities} from "../utilities/static.js";

function createStyleDiv(cache) {
  const root = document.createElement("div");

  function createNewRow(parent) {
    const row = document.createElement("div");
    row.classList.add("card-row");
    parent.appendChild(row);
    return row;
  }

  function appendVerticalRule(parent, label = undefined, tooltip = undefined, id = undefined, customCSSClass = undefined) {
    const verticalRule = document.createElement("div");
    verticalRule.className = "vr";
    if (customCSSClass) verticalRule.classList.add(customCSSClass);
    parent.appendChild(verticalRule);
    appendLabel(parent, label, tooltip, id, customCSSClass);
  }

  function appendHorizontalRule(parent, label = undefined, tooltip = undefined, id = undefined, customCSSClass = undefined) {
    const horizontalRule = document.createElement("hr");
    horizontalRule.className = "hr";
    if (customCSSClass) horizontalRule.classList.add(customCSSClass);
    parent.appendChild(horizontalRule);
  }

  function createLabel(labelText, tooltip = undefined) {
    if (labelText) {
      const label = document.createElement("label");
      label.textContent = labelText;
      label.className = "vr-label";
      label.id = labelText;
      if (tooltip) label.title = tooltip;
      return label;
    }
    return null;
  }

  function appendLabel(parent, labelText, tooltip = undefined, id = undefined, customCSSClass = undefined) {
    const label = createLabel(labelText, tooltip);
    if (id) label.id = id;
    if (customCSSClass) label.classList.add(customCSSClass);
    if (label) parent.appendChild(label);
  }

  function createCard(label, parent = undefined, additionalCSSClass = undefined) {
    const card = document.createElement("div");
    card.classList.add("card-labeled");
    if (additionalCSSClass) card.classList.add(additionalCSSClass);
    card.dataset.label = label;
    card.id = label;
    if (parent) {
      parent.appendChild(card);
    } else {
      root.appendChild(card);
    }
    return card;
  }

  function createSwitch(callback = undefined, inputId = undefined, enabledByDefault = false) {
    const label = document.createElement('label');
    label.className = 'switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabledByDefault;

    const span = document.createElement('span');
    span.className = 'slider round';

    if (callback) {
      input.addEventListener('change', callback);
    }

    if (inputId) {
      input.id = inputId;
      label.id = `${inputId}Label`;
    }

    label.append(input, span);

    label.setChecked = (checked) => {
      input.checked = checked;
    };

    label.toggle = () => {
      input.checked = !input.checked;
    };

    label.isChecked = () => input.checked;

    return label;
  }

  async function handleStyleChangeEvent(property, value) {
    const commands = [];

    if (value === "set_continuous_color_scale") {
      commands.push("set_continuous_color_scale");
      // Store property name in picker for display
      cache.picker.currentProperty = property;
    }

    if (value === "set_numeric_scale") {
      commands.push("set_numeric_scale");
    }

    if (property.startsWith("Bubble Set")) {
      await cache.bs.updateBubbleSetStyle(property, value);
      return;
    }

    switch (property) {
      case "Node Size":
        await cache.gcm.updateNodes({style: {size: value}}, commands);
        break;
      case "Node Border Size":
        await cache.gcm.updateNodes({style: {lineWidth: value}}, commands);
        break;
      case "Node Label Font Size":
        await cache.gcm.updateNodes({style: {labelFontSize: value}}, commands);
        break;
      case "Node Label Font Color":
        await cache.gcm.updateNodes({style: {labelFill: value}}, commands);
        break;
      case "Node Label Background Color":
        await cache.gcm.updateNodes({style: {labelBackground: true, labelBackgroundFill: value}}, commands);
        break;
      case "Node Fill Color":
        await cache.gcm.updateNodes({style: {fill: value}}, commands);
        break;
      case "Node Border Color":
        await cache.gcm.updateNodes({style: {stroke: value}}, commands);
        break;
      case "Node Label Color":
        await cache.gcm.updateNodes({style: {labelFill: value}}, commands);
        break;
      case "Node Label Placement":
        await cache.gcm.updateNodes({style: {labelPlacement: value}}, commands);
        break;
      case "Node Badge Font Size":
        await cache.gcm.updateNodes({style: {badgeFontSize: value}}, commands);
        break;
      case "Node Badge Scale With Node":
        await cache.gcm.updateNodes({style: {badgeScaleWithNode: value}}, commands);
        break;
      case "Edge Color":
        await cache.gcm.updateEdges({style: {stroke: value}}, commands);
        break;
      case "Edge Width":
        await cache.gcm.updateEdges({style: {lineWidth: value}}, commands);
        break;
      case "Edge Dash":
        await cache.gcm.updateEdges({style: {lineDash: value}}, commands);
        break;
      case "Edge Label Font Size":
        await cache.gcm.updateEdges({style: {labelFontSize: value}}, commands);
        break;
      case "Edge Label Offset X":
        await cache.gcm.updateEdges({style: {labelOffsetX: value}}, commands);
        break;
      case "Edge Label Offset Y":
        await cache.gcm.updateEdges({style: {labelOffsetY: value}}, commands);
        break;
      case "Edge Label Placement":
        await cache.gcm.updateEdges({style: {labelPlacement: value}}, commands);
        break;
      case "Edge Label Font Color":
        await cache.gcm.updateEdges({style: {labelFill: value}}, commands);
        break;
      case "Edge Label Background Color":
        await cache.gcm.updateEdges({style: {labelBackground: true, labelBackgroundFill: value}}, commands);
        break;
      case "Edge Label Auto Rotate":
        await cache.gcm.updateEdges({style: {labelAutoRotate: value}}, commands);
        break;
      case "Edge Start Arrow":
        await cache.gcm.updateEdges({style: {startArrow: value}}, commands);
        break;
      case "Edge End Arrow":
        await cache.gcm.updateEdges({style: {endArrow: value}}, commands);
        break;
      case "Edge Start Arrow Size":
        await cache.gcm.updateEdges({style: {startArrowSize: value}}, commands);
        break;
      case "Edge End Arrow Size":
        await cache.gcm.updateEdges({style: {endArrowSize: value}}, commands);
        break;
      case "Edge Start Arrow Type":
        await cache.gcm.updateEdges({style: {startArrowType: value}}, commands);
        break;
      case "Edge End Arrow Type":
        await cache.gcm.updateEdges({style: {endArrowType: value}}, commands);
        break;
      case "Edge Start Arrow Color":
        await cache.gcm.updateEdges({style: {startArrowColor: value}}, commands);
        break;
      case "Edge Start Arrow Border Color":
        await cache.gcm.updateEdges({style: {startArrowBorderColor: value}}, commands);
        break;
      case "Edge Start Arrow Border Size":
        await cache.gcm.updateEdges({style: {startArrowBorderSize: value}}, commands);
        break;
      case "Edge End Arrow Color":
        await cache.gcm.updateEdges({style: {endArrowColor: value}}, commands);
        break;
      case "Edge End Arrow Border Color":
        await cache.gcm.updateEdges({style: {endArrowBorderColor: value}}, commands);
        break;
      case "Edge End Arrow Border Size":
        await cache.gcm.updateEdges({style: {endArrowBorderSize: value}}, commands);
        break;
      case "Edge Halo":
        await cache.gcm.updateEdges({style: {halo: value}}, commands);
        break;
      case "Edge Halo Width":
        await cache.gcm.updateEdges({style: {haloLineWidth: value}}, commands);
        break;
      case "Edge Halo Color":
        await cache.gcm.updateEdges({style: {haloStroke: value}}, commands);
        break;
      case "Edge Flow":
        await cache.gcm.updateEdges({style: {flow: value}}, commands);
        break;
      case "Edge Flow Type":
        await cache.gcm.updateEdges({style: {flowType: value}}, commands);
        break;
      case "Edge Flow Speed":
        await cache.gcm.updateEdges({style: {flowSpeed: value}}, commands);
        break;
      case "Edge Flow Color":
        await cache.gcm.updateEdges({style: {flowStroke: value}}, commands);
        break;
      default:
        break;
    }
  }

  function createBooleanControls(parent, property, tooltip = undefined) {
    const onBtn = document.createElement("button");
    onBtn.textContent = "On";
    onBtn.classList.add("style-inner-button");
    onBtn.onclick = async () => {
      await handleStyleChangeEvent(property, true);
    }
    if (tooltip) onBtn.title = tooltip;
    parent.appendChild(onBtn);

    const offBtn = document.createElement("button");
    offBtn.textContent = "Off";
    offBtn.classList.add("style-inner-button");
    offBtn.onclick = async () => {
      await handleStyleChangeEvent(property, false);
    }
    if (tooltip) offBtn.title = tooltip;
    parent.appendChild(offBtn);
  }

  function createCategoricalControls(parent, property, defaultValue, listOfValues, tooltip = undefined) {
    const dropdown = document.createElement("select");
    dropdown.className = "style-inner-button";
    if (tooltip) dropdown.title = tooltip;

    listOfValues.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      dropdown.appendChild(option);
      dropdown.onchange = async () => {
        await handleStyleChangeEvent(property, dropdown.value);
      };
    });

    dropdown.value = defaultValue;
    parent.appendChild(dropdown);
  }

  function createNumericalSlider(parent, property, defaultValue, sliderParams = {
    min: 0,
    max: 100,
    step: 1
  }, tooltip = undefined, enableNumericScale = true) {
    const useFloat =
      !Number.isInteger(sliderParams.min) ||
      !Number.isInteger(sliderParams.max) ||
      !Number.isInteger(sliderParams.step);

    // A helper function to parse according to the useFloat flag
    function parseValue(val) {
      return useFloat ? parseFloat(val) : parseInt(val, 10);
    }

    const typedDefaultValue = parseValue(defaultValue);

    const container = document.createElement("div");
    container.className = "style-slider-container";
    container.dataset.property = property;
    if (tooltip) container.title = tooltip;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = sliderParams.min;
    slider.max = sliderParams.max;
    slider.step = sliderParams.step;
    slider.value = typedDefaultValue;
    slider.classList.add("style-slider");

    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.value = typedDefaultValue;
    valueInput.classList.add("style-input-sm");

    slider.oninput = () => {
      valueInput.value = slider.value;
    };

    slider.onchange = async () => {
      await handleStyleChangeEvent(property, parseValue(slider.value));
    };

    valueInput.onchange = async () => {
      slider.value = valueInput.value;
      await handleStyleChangeEvent(property, parseValue(valueInput.value));
    };

    container.appendChild(slider);
    container.appendChild(valueInput);

    // Add numeric scale button only for specific properties
    if (enableNumericScale) {
      const scaleButton = document.createElement("button");
      scaleButton.className = "style-inner-button style-numeric-scale-button";
      scaleButton.textContent = "∿";
      scaleButton.title = `Map by data: scale ${property} from a numeric property's values (e.g. larger nodes for higher degree)`;
      scaleButton.style.marginLeft = "2px";
      scaleButton.dataset.property = property;
      scaleButton.onclick = async () => {
        // Store property name in picker for retrieval in core.js
        cache.numericPicker.currentProperty = property;
        await handleStyleChangeEvent(property, "set_numeric_scale");
      };
      container.appendChild(scaleButton);
    }

    parent.appendChild(container);
  }

  function createColorPicker(defaultColor, title) {
    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.classList.add("style-inner-button");
    colorPicker.style.width = "24px";
    colorPicker.value = defaultColor;
    colorPicker.title = title;
    return colorPicker;
  }

  function createColorControls(parent, property, defaultColor, colors, continuousScaleBtn = true, customCSSClass = undefined) {
    const colorButtonDiv = document.createElement("div");
    colorButtonDiv.className = "style-color-button-container";
    if (customCSSClass) colorButtonDiv.classList.add(customCSSClass);

    for (const [label, value] of Object.entries(colors)) {
      const colorButton = document.createElement("button");
      colorButton.style.backgroundColor = value;
      colorButton.style.color = StaticUtilities.getReadableForegroundColor(value);
      colorButton.className = "style-inner-button style-color-button";
      colorButton.title = `Set ${property} of the selected elements to ${label} (${value}).`;

      if (label === "none") {
        colorButton.textContent = "×";
        colorButton.style.maxWidth = "12px";
      }

      colorButton.onclick = async () => {
        colorInput.value = value;
        await handleStyleChangeEvent(property, value);
      };

      if (customCSSClass) colorButton.classList.add(customCSSClass);
      colorButtonDiv.appendChild(colorButton);
    }

    parent.appendChild(colorButtonDiv);

    const colorPicker = createColorPicker(defaultColor,
      `Set ${property} of the selected elements to a color of choice.`);

    colorPicker.oninput = () => {
      colorInput.value = colorPicker.value;
    };

    colorPicker.onchange = async () => {
      await handleStyleChangeEvent(property, colorPicker.value);
    }

    const colorInput = document.createElement("input");
    colorInput.type = "text";
    colorInput.value = defaultColor;
    colorInput.classList.add("style-input");
    colorInput.dataset.property = property;
    colorInput.title = `Set ${property} of the selected elements to a color of choice (RGBA hex color code). Confirm with Enter`;
    colorInput.placeholder = `Enter Color`;

    colorInput.addEventListener("keypress", async function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        await handleStyleChangeEvent(property, colorInput.value);
      }
    });

    if (customCSSClass) {
      colorPicker.classList.add(customCSSClass);
      colorInput.classList.add(customCSSClass);
    }

    parent.appendChild(colorPicker);
    parent.appendChild(colorInput);

    if (continuousScaleBtn) {
      const contScaleBtn = document.createElement("button");
      contScaleBtn.className = "style-inner-button style-color-button style-color-gradient-button";
      contScaleBtn.title = `Map by data: colour ${property} on a continuous gradient from a property's values`;
      contScaleBtn.onclick = async () => {
        colorInput.value = "";
        await handleStyleChangeEvent(property, "set_continuous_color_scale");
      };

      if (customCSSClass) contScaleBtn.classList.add(customCSSClass)
      parent.appendChild(contScaleBtn);
    }
  }

  function createLabelControls(parent, property, isNode = null) {
    const labelInput = createInput(120, `Enter Custom ${property}`,
      `Set the label of the selected ${isNode ? "nodes" : "edges"} to a custom label.`, undefined,
      async () => {
        isNode ? await cache.gcm.updateNodes({
          style: {
            label: true,
            labelText: labelInput.value.trim()
          }
        }) : await cache.gcm.updateEdges({style: {label: true, labelText: labelInput.value.trim()}});
      });

    const clearLabelButton = createButton("Clear",
      `Clear the label of the selected ${isNode ? "nodes" : "edges"}.`, async () => {
        labelInput.value = "";
        const sharedOverride = {
          style: {
            label: true,
            labelText: cache.CFG.INVISIBLE_CHAR
          }
        };
        isNode ? await cache.gcm.updateNodes(sharedOverride) : await cache.gcm.updateEdges(sharedOverride);
        labelInput.value = "";
      });

    const setToIDButton = createButton("Set to ID",
      `Set the label of the selected ${isNode ? "nodes" : "edges"} to their predefined IDs.`, async () => {
        labelInput.value = "";
        const sharedCommands = ["label_set_to_id"];
        isNode ? await cache.gcm.updateNodes(undefined, sharedCommands) : await cache.gcm.updateEdges(undefined, sharedCommands);
      });
    const setToLabelButton = createButton("Set to Label",
      `Set the label of the selected ${isNode ? "nodes" : "edges"} to their predefined labels.`, async () => {
        labelInput.value = "";
        const sharedCommands = ["label_set_to_label"];
        isNode ? await cache.gcm.updateNodes(undefined, sharedCommands) : await cache.gcm.updateEdges(undefined, sharedCommands);
      });

    parent.appendChild(labelInput);
    parent.appendChild(setToIDButton);
    parent.appendChild(setToLabelButton);
    parent.appendChild(clearLabelButton);
  }

  function createButton(label, tooltip, callback, id = undefined) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = tooltip;
    btn.classList.add("style-inner-button");
    if (label === "Clear") btn.classList.add("red");
    if (id) {
      btn.id = id;
    } else {
      btn.id = label;
    }
    btn.onclick = () => {
      callback();
    }
    return btn;
  }

  function appendButton(parent, label, tooltip, callback) {
    const btn = createButton(label, tooltip, callback);
    parent.appendChild(btn);
  }

  function createInput(widthInPx = 80, placeholder = undefined, title = undefined,
                       defaultValue = undefined, callback = undefined) {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.title = title;
    input.classList.add("style-input");
    input.style.width = `${widthInPx}px`;
    input.value = defaultValue || "";
    if (callback) {
      input.addEventListener("keypress", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          callback(input.value.trim());
        }
      });
    }
    return input;
  }

  function createNodeShapeControls(parent) {
    for (const [label, value] of Object.entries(cache.DEFAULTS.STYLES.NODE_FORM)) {
      appendButton(parent, label, value,
        async () => await cache.gcm.updateNodes({type: value})
      );
    }
  }

  function createEdgeTypeControls(parent) {
    for (const label of cache.DEFAULTS.STYLES.EDGE_TYPES) {
      appendButton(parent, label, label, async () => await cache.gcm.updateEdges({type: label}));
    }
  }

  function createNodeBadgeControls(parent) {
    const badgeInput = createInput(120, "Enter Badge Text",
      "Enter the text of the badge to add to the selected nodes.", undefined, undefined);
    parent.appendChild(badgeInput);

    const badgeColorPicker = createColorPicker(cache.DEFAULTS.NODE.BADGE.COLOR, "Set the color of the badge.");
    parent.appendChild(badgeColorPicker);

    const badgePlacementDropdown = document.createElement("select");
    badgePlacementDropdown.className = "style-inner-button";
    cache.DEFAULTS.STYLES.NODE_BADGE_PLACEMENTS.forEach((placement) => {
      const option = document.createElement("option");
      option.value = placement;
      option.textContent = placement.replace("-", " ");
      badgePlacementDropdown.appendChild(option);
    });
    parent.appendChild(badgePlacementDropdown);

    appendButton(parent, "Add", "Add a badge to the selected nodes.", async () => {
      await cache.gcm.updateNodes({
          style: {
            badges: [{
              text: badgeInput.value.trim(),
              placement: badgePlacementDropdown.value
            }],
            badgePalette: [badgeColorPicker.value]
          }
        }, ["badge_add"]
      );
    });
    appendButton(parent, "Clear", "Clear all badges from the selected nodes.", async () => {
      await cache.gcm.updateNodes({}, ["badge_clear"]);
    });
  }

  function createFocusCard() {
    const focDiv = createCard("Focus Elements");

    const row1 = createNewRow(focDiv);
    appendLabel(row1, "Node", "Select the Node ID or Label to focus.", "nodeFocusLabel");
    appendEditableDropdown(row1, true);

    const row2 = createNewRow(focDiv);
    appendLabel(row2, "Edge", "Select the Edge ID or Label to focus.", "edgeFocusLabel");
    appendEditableDropdown(row2, false);
  }

  function appendEditableDropdown(parent, isNode, widthInPx = 220) {
    const input = document.createElement('input');
    const dataListID = `focusOptions${isNode ? 'Node' : 'Edge'}`;
    input.setAttribute('list', dataListID);
    input.placeholder = `Search ${isNode ? 'node' : 'edge'} ID or label...`;
    input.classList.add('style-input');
    input.style.width = `${widthInPx}px`;

    const datalist = document.createElement('datalist');
    datalist.id = dataListID;

    const sourceMap = isNode
      ? cache.nodeIDOrLabelToNodeIDs
      : cache.edgeIDOrLabelToEdgeIDs;

    const getVisibleIDs = () => {
      const visibleIDs = isNode ? cache.nodeIDsToBeShown : cache.edgeIDsToBeShown;
      return visibleIDs && visibleIDs.size ? visibleIDs : null;
    };

    const populateFocusOptions = () => {
      const visibleIDs = getVisibleIDs();
      const fragment = document.createDocumentFragment();
      datalist.textContent = '';
      for (const [key, ids] of sourceMap.entries()) {
        let include = !visibleIDs;
        if (visibleIDs) {
          for (const id of ids) {
            if (visibleIDs.has(id)) {
              include = true;
              break;
            }
          }
        }
        if (include) {
          const option = document.createElement('option');
          option.value = key;
          fragment.appendChild(option);
        }
      }
      datalist.appendChild(fragment);
    };

    populateFocusOptions();
    input.addEventListener('focus', populateFocusOptions);

    const focusButton = document.createElement('button');
    focusButton.textContent = 'Focus';
    focusButton.classList.add('style-inner-button');
    focusButton.onclick = async () => {
      const selectedValue = input.value;
      if (selectedValue) {
        const ids = sourceMap.get(selectedValue);
        if (ids) {
          if (ids.size !== 1) {
            cache.ui.warning(`Ambiguous selection: ${selectedValue} matches ${ids.size} ${isNode ? 'nodes' : 'edges'} (${Array.from(ids).join(',')}).`);
          }
          await cache.gcm.focusElements(ids, isNode);
        } else {
          cache.ui.warning(`No ${isNode ? 'node' : 'edge'} found for: ${selectedValue}`);
        }
      }
    };

    parent.appendChild(input);
    parent.appendChild(datalist);
    parent.appendChild(focusButton);
  }

  function createSelectCard() {
    const selDiv = createCard("Select Elements");

    const rowOne = createNewRow(selDiv);
    appendButton(rowOne, "All Nodes", "Select all visible nodes",
      async () => await cache.sm.toggleSelectionForAllNodes(true));
    appendButton(rowOne, "No Nodes", "Deselect all visible nodes",
      async () => await cache.sm.toggleSelectionForAllNodes(false));
    appendVerticalRule(rowOne);
    appendButton(rowOne, "All Edges", "Select all visible edges",
      async () => await cache.sm.toggleSelectionForAllEdges(true));
    appendButton(rowOne, "No Edges", "Deselect all visible edges",
      async () => await cache.sm.toggleSelectionForAllEdges(false));

    const rowTwo = createNewRow(selDiv);
    appendButton(rowTwo, "Expand Edges",
      "Add all edges connected to the currently selected nodes to the selection",
      async () => await cache.sm.toggleSelectionByNeighbors("expand-edges"));
    appendButton(rowTwo, "Reduce Edges",
      "Remove edges that do not connect two selected nodes",
      async () => await cache.sm.toggleSelectionByNeighbors("reduce-edges"));

    const rowThree = createNewRow(selDiv);
    appendButton(rowThree, "Expand Neighbors",
      "Add all directly connected neighbor nodes (and their edges) to the current selection",
      async () => await cache.sm.toggleSelectionByNeighbors("expand-neighbors"));
    appendButton(rowThree, "Reduce Neighbors",
      "Remove the outermost layer of selected neighbor nodes (and their edges) from the ",
      async () => await cache.sm.toggleSelectionByNeighbors("reduce-neighbors"));

    appendHorizontalRule(selDiv);

    const rowFour = createNewRow(selDiv);
    const nodeIDsTT = "Enter comma-separated list of node IDs to add/remove to/from selection\nConfirm with Enter";
    appendLabel(rowFour, "Node IDs", nodeIDsTT);
    const topTwoNodeIDs = cache.data?.nodes?.slice(0, 2).map(n => n.id).join(',') || 'Node1,Node2';
    const nodeIDsInput = createInput(190, topTwoNodeIDs, nodeIDsTT, undefined,
      async (val) => {
        await cache.sm.addNodeOrEdgeIDsToSelectionWrapper(val, true);
      });
    nodeIDsInput.id = "selectByNodeIDsInput";
    rowFour.appendChild(nodeIDsInput);
    const nodeIDsInputSwitch = createSwitch(e => {
      const btn = document.getElementById("selectByNodeIDsButton");
      if (e.target.checked) {
        btn.textContent = "Exclude";
        btn.classList.add("red");
        btn.title = "Remove the selected nodes from the selection";
      } else {
        btn.textContent = "Include";
        btn.classList.remove("red");
        btn.title = "Add the selected nodes to the selection";
      }
    }, "selectByNodeIDsSwitch");
    rowFour.appendChild(nodeIDsInputSwitch);
    const includeNodesByIdBtn = createButton("Include", "Add the selected nodes to the selection", async () => {
      const elements = document.getElementById("selectByNodeIDsInput").value;
      if (elements) {
        await cache.sm.addNodeOrEdgeIDsToSelectionWrapper(elements, true);
      }
    }, "selectByNodeIDsButton");
    rowFour.appendChild(includeNodesByIdBtn);

    const rowFive = createNewRow(selDiv);
    const edgeIDsTT = "Enter comma-separated list of edge IDs (SourceID::TargetID) to add/remove to/from selection\nConfirm with Enter";
    appendLabel(rowFive, "Edge IDs", edgeIDsTT);
    const topTwoEdgeIDs = cache.data?.edges?.slice(0, 2).map(e => e.id).join(',') || 'Node1::Node2,Node1::Node3';
    const edgeIDsInput = createInput(190, topTwoEdgeIDs, edgeIDsTT, undefined,
      async (val) => {
        await cache.sm.addNodeOrEdgeIDsToSelectionWrapper(val, false);
      });
    edgeIDsInput.id = "selectByEdgeIDsInput";
    rowFive.appendChild(edgeIDsInput);
    const edgeIDsInputSwitch = createSwitch(e => {
      const btn = document.getElementById("selectByEdgeIDsButton");
      if (e.target.checked) {
        btn.textContent = "Exclude";
        btn.classList.add("red");
        btn.title = "Remove the selected edges from the selection";
      } else {
        btn.textContent = "Include";
        btn.classList.remove("red");
        btn.title = "Add the selected edges to the selection";
      }
    }, "selectByEdgeIDsSwitch");
    rowFive.appendChild(edgeIDsInputSwitch);
    const includeEdgesByIdBtn = createButton("Include", "Add the selected nodes to the selection", async () => {
      const elements = document.getElementById("selectByEdgeIDsInput").value;
      if (elements) {
        await cache.sm.addNodeOrEdgeIDsToSelectionWrapper(elements, false);
      }
    }, "selectByEdgeIDsButton");
    rowFive.appendChild(includeEdgesByIdBtn);

    conditionallyCreateNodeOrEdgeSelectionRow(selDiv);
  }

  function conditionallyCreateNodeOrEdgeSelectionRow(selDiv) {
    let row;
    if (cache.nodeLabels.length > 0 || cache.edgeLabels.length > 0) {
      row = createNewRow(selDiv);
    }

    if (cache.nodeLabels.length > 0) {
      const nodeLabelsTT = "Enter comma-separated list of node labels to add/remove to/from selection\nConfirm with Enter";
      appendLabel(row, "Node Labels", nodeLabelsTT);
      const topTwoNodeLabels = cache.nodeLabels?.slice(0, 2).join(',') || 'Label1,Label2';
      const nodeLabelsInput = createInput(174, topTwoNodeLabels, nodeLabelsTT, undefined,
        async (val) => {
          await cache.sm.addNodeOrEdgeLabelsToSelectionWrapper(val, true);
        });
      nodeLabelsInput.id = "selectByNodeLabelsInput";
      row.appendChild(nodeLabelsInput);
      const nodeLabelsInputSwitch = createSwitch(e => {
        const btn = document.getElementById("selectByNodeLabelsButton");
        if (e.target.checked) {
          btn.textContent = "Exclude";
          btn.classList.add("red");
          btn.title = "Remove the selected nodes from the selection";
        } else {
          btn.textContent = "Include";
          btn.classList.remove("red");
          btn.title = "Add the selected nodes to the selection";
        }
      }, "selectByNodeLabelsSwitch");
      row.appendChild(nodeLabelsInputSwitch);
      const includeNodesByLabelBtn = createButton("Include", "Add the selected nodes to the selection", async () => {
        const elements = document.getElementById("selectByNodeLabelsInput").value;
        if (elements) {
          await cache.sm.addNodeOrEdgeLabelsToSelectionWrapper(elements, true);
        }
      }, "selectByNodeLabelsButton");
      row.appendChild(includeNodesByLabelBtn);
    }

    if (cache.edgeLabels.length > 0) {
      const edgeLabelsTT = "Enter comma-separated list of edge Labels to add/remove to/from selection\nConfirm with Enter";
      appendVerticalRule(row, "Edge Label(s)", edgeLabelsTT);
      const topTwoEdgeLabels = cache.edgeLabels.slice(0, 2).join(',') || 'Label1,Label2';
      const edgeLabelsInput = createInput(200, topTwoEdgeLabels, edgeLabelsTT, undefined,
        async (val) => {
          await cache.sm.addNodeOrEdgeLabelsToSelectionWrapper(val, false);
        });
      edgeLabelsInput.id = "selectByEdgeLabelsInput";
      row.appendChild(edgeLabelsInput);
      const edgeLabelsInputSwitch = createSwitch(e => {
        const btn = document.getElementById("selectByEdgeLabelsButton");
        if (e.target.checked) {
          btn.textContent = "Exclude";
          btn.classList.add("red");
          btn.title = "Remove the selected edges from the selection";
        } else {
          btn.textContent = "Include";
          btn.classList.remove("red");
          btn.title = "Add the selected edges to the selection";
        }
      }, "selectByEdgeLabelsSwitch");
      row.appendChild(edgeLabelsInputSwitch);
      const includeEdgesByLabelBtn = createButton("Include", "Add the selected nodes to the selection", async () => {
        const elements = document.getElementById("selectByEdgeLabelsInput").value;
        if (elements) {
          await cache.sm.addNodeOrEdgeLabelsToSelectionWrapper(elements, false);
        }
      }, "selectByEdgeLabelsButton");
      row.appendChild(includeEdgesByLabelBtn);
    }
  }

  function createArrangeNodesCard() {
    const arrDiv = createCard("Arrange Selection");

    const rowOne = createNewRow(arrDiv);
    appendButton(rowOne, "Shrink", "Move nodes closer together, halving their distance to the center.",
      async () => await cache.lm.layoutSelectedNodes("shrink"));
    appendButton(rowOne, "Expand", "Move nodes farther apart, doubling their distance to the center.",
      async () => await cache.lm.layoutSelectedNodes("expand"));
    appendVerticalRule(rowOne);
    appendButton(rowOne, "Circle", "Arrange nodes evenly in a circular layout around the center.",
      async () => await cache.lm.layoutSelectedNodes("circle"));
    appendButton(rowOne, "Force", "Apply a force-directed layout to the selected nodes.",
      async () => await cache.lm.layoutSelectedNodes("force"));
    appendButton(rowOne, "Grid", "Apply a uniform grid layout to the selected nodes.",
      async () => await cache.lm.layoutSelectedNodes("grid"));
    appendButton(rowOne, "Random", "Apply a random layout to the selected nodes while preserving the original layout bonds.",
      async () => await cache.lm.layoutSelectedNodes("random"));
  }

  function createNodeConfigCard() {
    const nodeDiv = createCard("Node Configuration");

    const rowOne = createNewRow(nodeDiv);
    appendLabel(rowOne, "Shape");
    createNodeShapeControls(rowOne);
    appendVerticalRule(rowOne);
    appendButton(rowOne, "Pie…",
      "Render the selected nodes as pie charts: map categorical values (equal slices) or numeric properties (sized slices) to wedges.",
      async () => await cache.gcm.updateNodes({}, ["set_pie_chart"]));
    appendButton(rowOne, "Clear pie", "Remove pie-chart rendering and restore the nodes' shape.",
      async () => await cache.gcm.updateNodes({}, ["clear_pie_chart"]));

    const rowTwo = createNewRow(nodeDiv);
    appendLabel(rowTwo, "Size");
    createNumericalSlider(rowTwo, "Node Size", cache.DEFAULTS.NODE.SIZE, {min: 10, max: 50, step: 1});

    const rowThree = createNewRow(nodeDiv);
    appendLabel(rowThree, "Fill Color");
    createColorControls(rowThree, "Node Fill Color", cache.DEFAULTS.NODE.FILL_COLOR, cache.DEFAULTS.STYLES.NODE_COLORS);

    const rowFour = createNewRow(nodeDiv);
    appendLabel(rowFour, "Border Size", "Defines the width of the border of the selected nodes.");
    createNumericalSlider(rowFour, "Node Border Size", cache.DEFAULTS.NODE.LINE_WIDTH,
      {min: 1, max: 10, step: 1}, "Defines the width of the border of the selected nodes.");

    const rowFive = createNewRow(nodeDiv);
    appendLabel(rowFive, "Border Color", "Defines the fill color of the selected nodes.");
    createColorControls(rowFive, "Node Border Color", cache.DEFAULTS.NODE.STROKE_COLOR,
      cache.DEFAULTS.STYLES.NODE_BORDER_COLORS);

    appendHorizontalRule(nodeDiv);

    const rowSix = createNewRow(nodeDiv);
    appendLabel(rowSix, "Label", "Customize the selected nodes labels.");
    createLabelControls(rowSix, "Node Label", true);

    const rowSeven = createNewRow(nodeDiv);
    appendLabel(rowSeven, "Label Font Size", "Defines the font size of the selected nodes labels.");
    createNumericalSlider(rowSeven, "Node Label Font Size", cache.DEFAULTS.NODE.LABEL.FONT_SIZE,
      {min: 10, max: 30, step: 1}, "Defines the font size of the selected nodes labels.");

    const rowEight = createNewRow(nodeDiv);
    appendLabel(rowEight, "Label Placement", "Defines the placement of the selected nodes labels.");
    createCategoricalControls(rowEight, "Node Label Placement", cache.DEFAULTS.NODE.LABEL.PLACEMENT,
      cache.DEFAULTS.STYLES.NODE_LABEL_PLACEMENTS, "Defines the placement of the selected nodes labels.");

    const rowNine = createNewRow(nodeDiv);
    appendLabel(rowNine, "Label Color",
      "Defines the foreground (text) color of the selected nodes labels.");
    createColorControls(rowNine, "Node Label Font Color", cache.DEFAULTS.NODE.LABEL.FOREGROUND_COLOR,
      cache.DEFAULTS.STYLES.NODE_LABEL_COLORS);

    const rowTen = createNewRow(nodeDiv);
    appendLabel(rowTen, "Label Background Color",
      "Defines the background color of the selected nodes labels.");
    createColorControls(rowTen, "Node Label Background Color", cache.DEFAULTS.NODE.LABEL.BACKGROUND_COLOR,
      cache.DEFAULTS.STYLES.NODE_LABEL_BACKGROUND_COLORS);

    appendHorizontalRule(nodeDiv);

    const rowEleven = createNewRow(nodeDiv);
    appendLabel(rowEleven, "Badges", "Add Badges to the selected nodes.");
    createNodeBadgeControls(rowEleven);

    const rowTwelve = createNewRow(nodeDiv);
    appendLabel(rowTwelve, "Badge Size", "Defines the font size (and pill size) of the selected nodes badges.");
    createNumericalSlider(rowTwelve, "Node Badge Font Size", cache.DEFAULTS.NODE.BADGE.FONT_SIZE,
      {min: 4, max: 32, step: 1}, "Defines the font size (and pill size) of the selected nodes badges.");

    const rowThirteen = createNewRow(nodeDiv);
    appendLabel(rowThirteen, "Badge Scale With Node",
      "Scale badges proportionally with each node's size (relative to the default node size).");
    createBooleanControls(rowThirteen, "Node Badge Scale With Node",
      "Scale badges proportionally with each node's size (relative to the default node size).");
  }

  function createEdgeConfigCard() {
    const edgeDiv = createCard("Edge Configuration");

    const rowOne = createNewRow(edgeDiv);
    appendLabel(rowOne, "Type", "Change the geometric edge type of the selected edges.");
    createEdgeTypeControls(rowOne);

    const rowTwo = createNewRow(edgeDiv);
    appendLabel(rowTwo, "Line Width", "Change the width of the selected edges.");
    createNumericalSlider(rowTwo, "Edge Width", cache.DEFAULTS.EDGE.LINE_WIDTH,
      {min: 0.1, max: 10.0, step: 0.1}, "Change the width of the selected edges.");

    const rowThree = createNewRow(edgeDiv);
    appendLabel(rowThree, "Line Dash", "Define the dash pattern of the selected edges.");
    createNumericalSlider(rowThree, "Edge Dash", cache.DEFAULTS.EDGE.LINE_DASH,
      {min: 0, max: 40, step: 1}, "Define the dash pattern of the selected edges.");

    const rowFour = createNewRow(edgeDiv);
    appendLabel(rowFour, "Color", "Define the selected edges color.");
    createColorControls(rowFour, "Edge Color", cache.DEFAULTS.EDGE.COLOR, cache.DEFAULTS.STYLES.EDGE_COLORS);

    appendHorizontalRule(edgeDiv);

    const rowFive = createNewRow(edgeDiv);
    appendLabel(rowFive, "Label", "Customize the selected edges labels.");
    createLabelControls(rowFive, "Edge Label");

    const rowSix = createNewRow(edgeDiv);
    appendLabel(rowSix, "Label Font Size", "Defines the font size of the selected edges labels.");
    createNumericalSlider(rowSix, "Edge Label Font Size", cache.DEFAULTS.EDGE.LABEL.FONT_SIZE,
      {min: 10, max: 30, step: 1}, "Defines the font size of the selected edges labels.");

    const rowSeven = createNewRow(edgeDiv);
    appendLabel(rowSeven, "Label Placement", "Defines the placement of the selected edges labels.");
    createCategoricalControls(rowSeven, "Edge Label Placement", cache.DEFAULTS.EDGE.LABEL.PLACEMENT,
      cache.DEFAULTS.STYLES.EDGE_LABEL_PLACEMENTS, "Defines the placement of the selected edges labels.");

    const rowEight = createNewRow(edgeDiv);
    appendLabel(rowEight, "Label Auto Rotate", "Enable/Disable label rotation.");
    createBooleanControls(rowEight, "Edge Label Auto Rotate", "Enable/Disable label rotation.");

    const rowNine = createNewRow(edgeDiv);
    appendLabel(rowNine, "Label Offset X",
      "Define the offset of the selected edges labels along the X-axis.");
    createNumericalSlider(rowNine, "Edge Label Offset X", cache.DEFAULTS.EDGE.LABEL.OFFSET_X,
      {min: -100, max: 100, step: 1},
      "Define the offset of the selected edges labels along the X-axis.", false);

    const rowTen = createNewRow(edgeDiv);
    appendLabel(rowTen, "Label Offset Y",
      "Define the offset of the selected edges labels along the Y-axis.");
    createNumericalSlider(rowTen, "Edge Label Offset Y", cache.DEFAULTS.EDGE.LABEL.OFFSET_Y,
      {min: -100, max: 100, step: 1},
      "Define the offset of the selected edges labels along the Y-axis.", false);

    const rowEleven = createNewRow(edgeDiv);
    appendLabel(rowEleven, "Label Color",
      "Defines the foreground (text) color of the selected edges labels.");
    createColorControls(rowEleven, "Edge Label Font Color", cache.DEFAULTS.EDGE.LABEL.FOREGROUND_COLOR,
      cache.DEFAULTS.STYLES.EDGE_LABEL_COLORS, "Defines the foreground (text) color of the selected edges labels.");

    const rowTwelve = createNewRow(edgeDiv);
    appendLabel(rowTwelve, "Label Background Color",
      "Defines the background color of the selected edges labels.");
    createColorControls(rowTwelve, "Edge Label Background Color", cache.DEFAULTS.EDGE.LABEL.BACKGROUND_COLOR,
      cache.DEFAULTS.STYLES.EDGE_LABEL_BACKGROUND_COLORS, "Defines the background color of the selected edges labels.");

    appendHorizontalRule(edgeDiv);

    const rowThirteen = createNewRow(edgeDiv);
    appendLabel(rowThirteen, "Start Arrow", "Enable/Disable the start arrow of the selected edges.");
    createBooleanControls(rowThirteen, "Edge Start Arrow", "Enable/Disable the start arrow of the selected edges.");

    const rowFourteen = createNewRow(edgeDiv);
    appendLabel(rowFourteen, "Start Arrow Size", "Define the size of the start marker of the selected edges.");
    createNumericalSlider(rowFourteen, "Edge Start Arrow Size", cache.DEFAULTS.EDGE.ARROWS.START_SIZE,
      {min: 4, max: 40, step: 1}, "Define the size of the start marker of the selected edges.", true);

    const rowFifteen = createNewRow(edgeDiv);
    appendLabel(rowFifteen, "Start Arrow Type",
      "Marker shape at the source end: arrow/rect/diamond/circle encode direction, tee (⊣) encodes inhibition.");
    createCategoricalControls(rowFifteen, "Edge Start Arrow Type", cache.DEFAULTS.EDGE.ARROWS.START_TYPE,
      cache.DEFAULTS.STYLES.EDGE_ARROW_TYPES,
      "Marker shape at the source end: arrow/rect/diamond/circle encode direction, tee (⊣) encodes inhibition.");

    const rowFifteenColor = createNewRow(edgeDiv);
    appendLabel(rowFifteenColor, "Start Arrow Color",
      "Fill color of the start marker. Leave unset to inherit the edge color.");
    createColorControls(rowFifteenColor, "Edge Start Arrow Color", cache.DEFAULTS.EDGE.COLOR,
      cache.DEFAULTS.STYLES.EDGE_ARROW_COLORS,
      "Fill color of the start marker. Leave unset to inherit the edge color.");

    const rowFifteenBorder = createNewRow(edgeDiv);
    appendLabel(rowFifteenBorder, "Start Arrow Border Color",
      "Outline color of the start marker. Set to none for no border.");
    createColorControls(rowFifteenBorder, "Edge Start Arrow Border Color", cache.DEFAULTS.EDGE.HALO.COLOR,
      cache.DEFAULTS.STYLES.EDGE_ARROW_BORDER_COLORS,
      "Outline color of the start marker. Set to none for no border.");

    const rowFifteenBorderSize = createNewRow(edgeDiv);
    appendLabel(rowFifteenBorderSize, "Start Arrow Border Size",
      "Thickness of the start marker border in px. 0 = auto (scales with the arrow).");
    createNumericalSlider(rowFifteenBorderSize, "Edge Start Arrow Border Size",
      cache.DEFAULTS.EDGE.ARROWS.START_BORDER_SIZE, {min: 0, max: 20, step: 1},
      "Thickness of the start marker border in px. 0 = auto (scales with the arrow).", true);

    const rowSixteen = createNewRow(edgeDiv);
    appendLabel(rowSixteen, "End Arrow", "Enable/Disable the end arrow of the selected edges.");
    createBooleanControls(rowSixteen, "Edge End Arrow", "Enable/Disable the end arrow of the selected edges.");

    const rowEighteen = createNewRow(edgeDiv);
    appendLabel(rowEighteen, "End Arrow Size", "Define the size of the end marker of the selected edges.");
    createNumericalSlider(rowEighteen, "Edge End Arrow Size", cache.DEFAULTS.EDGE.ARROWS.END_SIZE,
      {min: 4, max: 40, step: 1}, "Define the size of the end marker of the selected edges.", true);

    const rowNineteen = createNewRow(edgeDiv);
    appendLabel(rowNineteen, "End Arrow Type",
      "Marker shape at the target end: arrow/rect/diamond/circle encode direction, tee (⊣) encodes inhibition.");
    createCategoricalControls(rowNineteen, "Edge End Arrow Type", cache.DEFAULTS.EDGE.ARROWS.END_TYPE,
      cache.DEFAULTS.STYLES.EDGE_ARROW_TYPES,
      "Marker shape at the target end: arrow/rect/diamond/circle encode direction, tee (⊣) encodes inhibition.");

    const rowNineteenColor = createNewRow(edgeDiv);
    appendLabel(rowNineteenColor, "End Arrow Color",
      "Fill color of the end marker. Leave unset to inherit the edge color.");
    createColorControls(rowNineteenColor, "Edge End Arrow Color", cache.DEFAULTS.EDGE.COLOR,
      cache.DEFAULTS.STYLES.EDGE_ARROW_COLORS,
      "Fill color of the end marker. Leave unset to inherit the edge color.");

    const rowNineteenBorder = createNewRow(edgeDiv);
    appendLabel(rowNineteenBorder, "End Arrow Border Color",
      "Outline color of the end marker. Set to none for no border.");
    createColorControls(rowNineteenBorder, "Edge End Arrow Border Color", cache.DEFAULTS.EDGE.HALO.COLOR,
      cache.DEFAULTS.STYLES.EDGE_ARROW_BORDER_COLORS,
      "Outline color of the end marker. Set to none for no border.");

    const rowNineteenBorderSize = createNewRow(edgeDiv);
    appendLabel(rowNineteenBorderSize, "End Arrow Border Size",
      "Thickness of the end marker border in px. 0 = auto (scales with the arrow).");
    createNumericalSlider(rowNineteenBorderSize, "Edge End Arrow Border Size",
      cache.DEFAULTS.EDGE.ARROWS.END_BORDER_SIZE, {min: 0, max: 20, step: 1},
      "Thickness of the end marker border in px. 0 = auto (scales with the arrow).", true);

    appendHorizontalRule(edgeDiv);

    const rowTwenty = createNewRow(edgeDiv);
    appendLabel(rowTwenty, "Halo", "Enable/Disable a halo around the selected edges.");
    createBooleanControls(rowTwenty, "Edge Halo", "Enable/Disable a halo around the selected edges.");

    const rowTwentyOne = createNewRow(edgeDiv);
    appendLabel(rowTwentyOne, "Halo Color", "Define the color of the halo for the selected edges.");
    createColorControls(rowTwentyOne, "Edge Halo Color", cache.DEFAULTS.EDGE.HALO.COLOR,
      cache.DEFAULTS.STYLES.EDGE_COLORS);

    const rowTwentyTwo = createNewRow(edgeDiv);
    appendLabel(rowTwentyTwo, "Halo Width", "Define the halo width for the selected edges.");
    createNumericalSlider(rowTwentyTwo, "Edge Halo Width", cache.DEFAULTS.EDGE.HALO.WIDTH,
      {min: 1, max: 30, step: 1}, "Define the halo width for the selected edges.");

    appendHorizontalRule(edgeDiv);

    const rowTwentyThree = createNewRow(edgeDiv);
    appendLabel(rowTwentyThree, "Flow",
      "Animate a directional flow along the selected edges (source → target).");
    createBooleanControls(rowTwentyThree, "Edge Flow",
      "Animate a directional flow along the selected edges (source → target).");

    const rowTwentyFour = createNewRow(edgeDiv);
    appendLabel(rowTwentyFour, "Flow Type", "dash = marching dashes, pulse = travelling dots.");
    createCategoricalControls(rowTwentyFour, "Edge Flow Type", cache.DEFAULTS.EDGE.FLOW.TYPE,
      cache.DEFAULTS.STYLES.EDGE_FLOW_TYPES, "dash = marching dashes, pulse = travelling dots.");

    const rowTwentyFive = createNewRow(edgeDiv);
    appendLabel(rowTwentyFive, "Flow Speed", "Speed multiplier for the flow animation.");
    createNumericalSlider(rowTwentyFive, "Edge Flow Speed", cache.DEFAULTS.EDGE.FLOW.SPEED,
      {min: 0.2, max: 5, step: 0.2}, "Speed multiplier for the flow animation.", true);

    const rowTwentySix = createNewRow(edgeDiv);
    appendLabel(rowTwentySix, "Flow Color",
      "Color of the flow overlay. Leave unset to derive a lighter shade of the edge color.");
    // Swatch stand-in only (FLOW.COLOR is null = "derive from the stroke") —
    // same convention as the arrow-color rows defaulting to EDGE.COLOR.
    createColorControls(rowTwentySix, "Edge Flow Color", cache.DEFAULTS.EDGE.COLOR,
      cache.DEFAULTS.STYLES.EDGE_COLORS);
  }

  function createBubbleSetConfigCard() {
    const bubbleDiv = createCard("Bubble Sets", undefined, "bubble-set-config-card-header");
    const optionalCSSClass = "bubbleSetOptionalLabelConfig";

    // Tab bar
    const tabBar = document.createElement("div");
    tabBar.className = "bubble-set-tab-bar";
    bubbleDiv.appendChild(tabBar);

    const panels = [];
    let tabIndex = 0;

    for (const group of cache.bs.traverseBubbleSets()) {
      tabIndex++;
      const bs = cache.data.layouts[cache.data.selectedLayout].bubbleSetStyle[group];

      // Create tab button with group color accent
      const tab = document.createElement("button");
      tab.className = `bubble-set-tab${tabIndex === 1 ? " active" : ""}`;
      tab.textContent = `Bubble Set ${tabIndex}`;
      tab.dataset.group = group;
      tab.style.setProperty("--tab-color", bs.fill);
      tab.style.setProperty("--tab-text-color", StaticUtilities.getReadableForegroundColor(bs.fill));
      tabBar.appendChild(tab);

      // Create tab panel
      const panel = document.createElement("div");
      panel.className = `bubble-set-tab-panel${tabIndex === 1 ? " active" : ""}`;
      panel.id = `bubbleSetStyleCard${group}`;
      bubbleDiv.appendChild(panel);
      panels.push(panel);

      tab.onclick = () => {
        tabBar.querySelectorAll(".bubble-set-tab").forEach(t => t.classList.remove("active"));
        panels.forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        panel.classList.add("active");
      };

      // Fill Color
      const rowFillColor = createNewRow(panel);
      appendLabel(rowFillColor, "Fill Color");
      createColorControls(rowFillColor, `Bubble Set ${group} Fill Color`, bs.fill, [], false);

      // Fill Opacity
      const rowFillOpacity = createNewRow(panel);
      appendLabel(rowFillOpacity, "Fill Opacity");
      createNumericalSlider(rowFillOpacity, `Bubble Set ${group} Fill Opacity`, bs.fillOpacity,
        {min: 0, max: 1, step: 0.01}, `Define the fill opacity of bubble set ${tabIndex}.`, false);

      // Stroke Color
      const rowStrokeColor = createNewRow(panel);
      appendLabel(rowStrokeColor, "Stroke Color");
      createColorControls(rowStrokeColor, `Bubble Set ${group} Stroke Color`, bs.stroke, [], false);

      // Stroke Opacity
      const rowStrokeOpacity = createNewRow(panel);
      appendLabel(rowStrokeOpacity, "Stroke Opacity");
      createNumericalSlider(rowStrokeOpacity, `Bubble Set ${group} Stroke Opacity`, bs.strokeOpacity,
        {min: 0, max: 1, step: 0.01}, `Define the stroke opacity of bubble set ${tabIndex}.`, false);

      // Label (toggle + text input)
      const rowLabel = createNewRow(panel);
      appendLabel(rowLabel, "Label Text");
      const enableTextSwitch = createSwitch(async () => {
        await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label`, enableTextSwitch.isChecked());
      }, undefined, bs.label);
      rowLabel.appendChild(enableTextSwitch);
      const labelInput = createInput(120, `${group} label text`,
        `Enter the label text for bubble set ${tabIndex}.`, bs.labelText, async () => {
        await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Text`, labelInput.value.trim());
      });
      labelInput.classList.add(optionalCSSClass);
      rowLabel.appendChild(labelInput);

      // Label Background (toggle + color)
      const rowLabelBg = createNewRow(panel);
      appendLabel(rowLabelBg, "Label Background", undefined, undefined, optionalCSSClass);
      const enableBackgroundSwitch = createSwitch(async () => {
        await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Background`, enableBackgroundSwitch.isChecked());
      }, undefined, bs.labelBackground);
      enableBackgroundSwitch.classList.add(optionalCSSClass);
      rowLabelBg.appendChild(enableBackgroundSwitch);
      createColorControls(rowLabelBg, `Bubble Set ${group} Label Background Color`,
        bs.labelBackgroundFill || bs.fill, [], false, optionalCSSClass);

      // Label Fill Color
      const rowLabelFill = createNewRow(panel);
      appendLabel(rowLabelFill, "Label Color", undefined, undefined, optionalCSSClass);
      createColorControls(rowLabelFill, `Bubble Set ${group} Label Fill Color`, bs.labelFill, [], false, optionalCSSClass);

      // Label Font Size
      const rowFontSize = createNewRow(panel);
      appendLabel(rowFontSize, "Label Font Size", undefined, undefined, optionalCSSClass);
      createNumericalSlider(rowFontSize, `Bubble Set ${group} Label Font Size`, bs.labelFontSize,
        {min: 6, max: 36, step: 1}, `Define the label font size for bubble set ${tabIndex}.`, false);
      rowFontSize.lastChild.classList.add(optionalCSSClass);

      // Label Placement
      const rowPlacement = createNewRow(panel);
      appendLabel(rowPlacement, "Label Placement", undefined, undefined, optionalCSSClass);
      const placementDropdown = document.createElement("select");
      placementDropdown.className = "style-inner-button";
      placementDropdown.dataset.property = `Bubble Set ${group} Label Placement`;
      placementDropdown.classList.add(optionalCSSClass);
      ['left', 'right', 'top', 'bottom', 'center'].forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        placementDropdown.appendChild(opt);
      });
      placementDropdown.value = bs.labelPlacement;
      placementDropdown.onchange = async () => {
        await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Placement`, placementDropdown.value);
      };
      rowPlacement.appendChild(placementDropdown);

      // Label Close To Path
      const rowClosePath = createNewRow(panel);
      appendLabel(rowClosePath, "Close To Path", undefined, undefined, optionalCSSClass);
      const closeToPathSwitch = createSwitch(async () => {
        await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Close To Path`, closeToPathSwitch.isChecked());
      }, undefined, bs.labelCloseToPath);
      closeToPathSwitch.classList.add(optionalCSSClass);
      closeToPathSwitch.dataset.property = `Bubble Set ${group} Label Close To Path`;
      rowClosePath.appendChild(closeToPathSwitch);

      // Label Auto Rotate
      const rowAutoRotate = createNewRow(panel);
      appendLabel(rowAutoRotate, "Auto Rotate", undefined, undefined, optionalCSSClass);
      const autoRotateSwitch = createSwitch(async () => {
        await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Auto Rotate`, autoRotateSwitch.isChecked());
      }, undefined, bs.labelAutoRotate);
      autoRotateSwitch.classList.add(optionalCSSClass);
      autoRotateSwitch.dataset.property = `Bubble Set ${group} Label Auto Rotate`;
      rowAutoRotate.appendChild(autoRotateSwitch);

      // Label Offset X
      const rowOffsetX = createNewRow(panel);
      appendLabel(rowOffsetX, "Label Offset X", undefined, undefined, optionalCSSClass);
      createNumericalSlider(rowOffsetX, `Bubble Set ${group} Label Offset X`, bs.labelOffsetX,
        {min: -50, max: 50, step: 1}, `Define the label X offset for bubble set ${tabIndex}.`, false);
      rowOffsetX.lastChild.classList.add(optionalCSSClass);

      // Label Offset Y
      const rowOffsetY = createNewRow(panel);
      appendLabel(rowOffsetY, "Label Offset Y", undefined, undefined, optionalCSSClass);
      createNumericalSlider(rowOffsetY, `Bubble Set ${group} Label Offset Y`, bs.labelOffsetY,
        {min: -50, max: 50, step: 1}, `Define the label Y offset for bubble set ${tabIndex}.`, false);
      rowOffsetY.lastChild.classList.add(optionalCSSClass);
    }
  }

  // Turn a config card into a collapsible section: replace the floating
  // `::before` title with a real clickable header (so the panel reads as a
  // set of foldable sections instead of one tall wall of controls).
  function makeCollapsible(label, startCollapsed = false) {
    const card = root.querySelector(`[data-label="${label}"]`);
    if (!card) return;
    card.classList.add("card-collapsible");

    const header = document.createElement("button");
    header.type = "button";
    header.className = "card-collapse-header";
    header.setAttribute("aria-expanded", startCollapsed ? "false" : "true");

    const title = document.createElement("span");
    title.className = "card-collapse-title";
    title.textContent = label;

    const chevron = document.createElement("span");
    chevron.className = "card-collapse-chevron";
    chevron.textContent = startCollapsed ? "▸" : "▾";

    header.append(title, chevron);
    header.addEventListener("click", () => {
      const collapsed = card.classList.toggle("collapsed");
      chevron.textContent = collapsed ? "▸" : "▾";
      header.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });

    card.insertBefore(header, card.firstChild);
    if (startCollapsed) card.classList.add("collapsed");
  }

  createFocusCard();
  createSelectCard();
  createArrangeNodesCard();
  createNodeConfigCard();
  createEdgeConfigCard();
  createBubbleSetConfigCard();

  // Node stays open (most common); Edge is the largest section so it starts
  // folded; bubble styling only matters once groups exist, so fold it too.
  makeCollapsible("Node Configuration");
  makeCollapsible("Edge Configuration", true);
  makeCollapsible("Bubble Sets", true);

  return root;
}

export {createStyleDiv}
