/**
 * @class SpandrixEngine
 * @description A modular, reactive DOM engine.
 * Generated on: June 3, 2025
 */
class SpandrixEngine {
    constructor(rootSelector, userOptions = {}) {
        this.root = document.querySelector(rootSelector);
        if (!this.root) {
            console.warn(`Spandrix: Root element with selector "${rootSelector}" not found.`);
        }
        this._originalRootTemplate = this.root ? this.root.innerHTML : '';
        this.options = Object.assign({
            missingValuePlaceholder: '', debug: false, componentIdPrefix: 'spx-c-',
            strictExpressions: false, warnOnUnsafeEval: true, allowRawHTML: false,
            csrfCookieName: 'XSRF-TOKEN', csrfHeaderName: 'X-XSRF-TOKEN'
        }, userOptions || {});

        this.components = {};
        this.filters = {};
        this._eventListeners = [];

        this._rootDataUpdateCallback = (target, key, value, oldValue) => {
            this._logDebug(`Root data reactive change on key '${String(key)}':`, oldValue, '->', value, ". Triggering root re-render.");
            Promise.resolve().then(() => {
                 this._reRenderRoot(this._currentRootTemplateString, this._currentRootData);
            }).catch(error => console.error("Spandrix: Error in promise for root re-render from _currentRootData:", error));
        };

        this._currentRootDataTarget = {};
        this._currentRootData = this._makeReactive(this._currentRootDataTarget, this._rootDataUpdateCallback, '_currentRootData_initial');

        this._currentRootTemplateString = null;

        this.globalData = this._makeReactive({}, () => {
            this._logDebug('GlobalData changed, triggering relevant component updates and potentially root re-render.');
            this._updateComponentsUsingGlobalStateOrGlobalData();
        }, 'globalData');

        this._componentCounter = 0;

        this.$state = this._makeReactive({}, (target, key, value, oldValue) => {
            this._logDebug(`Global $state changed: ${String(key)} from`, oldValue, 'to', value, ". Re-evaluating watchers & components.");
            this._stateWatchers.forEach(w => {
                if (w.path === key || w.path.startsWith(key + '.') || String(key).startsWith(w.path + '.')) {
                    const currentVal = this._getValueByPath(this.$state, w.path);
                    if (JSON.stringify(currentVal) !== JSON.stringify(w.lastValue)) {
                        try { w.callback.call(this.$state, currentVal, w.lastValue); }
                        catch (e) { console.error('Global state watcher error:', e); }
                        w.lastValue = JSON.parse(JSON.stringify(currentVal));
                    }
                }
            });
            this._updateComponentsUsingGlobalStateOrGlobalData();
        }, '$state');
        this._stateWatchers = [];

        // this.router = null; // Router removed
        this.plugins = [];
        this._hooks = {
            beforeComponentCreate: [], afterComponentCreate: [],
            beforeComponentMount: [], afterComponentMount: [],
            beforeComponentUpdate: [], afterComponentUpdate: [],
            beforeComponentDestroy: [], afterComponentDestroy: [],
            // beforeRouteEnter: [], beforeRouteLeave: [], // Router hooks removed
        };
        this._requestInterceptors = [];
        this._responseInterceptors = [];
        this._fetchCache = new Map();
        this._registerSystemComponents();
    }

    _logDebug(...args) { if (this.options.debug) console.debug('[Spandrix DEBUG]', ...args); }
    enableDebug() { this.options.debug = true; this._logDebug('Debug mode enabled.'); }
    disableDebug() { this.options.debug = false; }
    config(newOptions = {}) {
        if (this._configLocked) { console.warn('Spandrix: Config is locked.'); return; }
        Object.assign(this.options, newOptions);
        this._logDebug('Configuration updated:', this.options);
    }
    lockConfig() { this._configLocked = true; this._logDebug('Configuration locked.'); }
    _generateComponentId() { return `${this.options.componentIdPrefix}${this._componentCounter++}`; }

    _makeReactive(obj, updateCallback, contextName = 'object') {
        const engine = this;
        if (obj && obj._isReactiveProxy) return obj;

        return new Proxy(obj, {
            get(target, key, receiver) {
                if (key === '_isReactiveProxy') return true;
                const value = Reflect.get(target, key, receiver);
                if (typeof value === 'object' && value !== null && !value._isReactiveProxy &&
                    !Object.isFrozen(value) && !(value instanceof Node) &&
                    (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
                    // Ensure we only create a new proxy if the object instance has changed or not yet proxied.
                    if (target[key] === value) { // Check if it's the same instance that was originally set
                        target[key] = engine._makeReactive(value, () => updateCallback(target, String(key), target[key], value), `${contextName}.${String(key)}`);
                    }
                }
                return target[key]; // Return the (potentially newly proxied) value
            },
            set(target, key, value, receiver) {
                const oldValue = target[key];
                if (value === oldValue && (typeof value !== 'object' || value === null)) return true; // No change

                const result = Reflect.set(target, key, value, receiver);
                if (result && JSON.stringify(oldValue) !== JSON.stringify(value) && !String(key).startsWith('_')) {
                    engine._logDebug(`Reactive change in ${contextName}: ${String(key)} =`, value, '(was:', oldValue, ')');
                    if (updateCallback) updateCallback(target, String(key), value, oldValue);
                }
                return result;
            },
            deleteProperty(target, key) {
                const oldValue = target[key];
                const result = Reflect.deleteProperty(target, key);
                if (result && !String(key).startsWith('_')) {
                    engine._logDebug(`Reactive delete in ${contextName}: ${String(key)}`);
                    if (updateCallback) updateCallback(target, String(key), undefined, oldValue);
                }
                return result;
            }
        });
    }

    setGlobalData(globalObj) {
        if (typeof globalObj === 'object' && globalObj !== null) {
            // Efficiently update globalData: delete removed keys, update/add others
            for (const key in this.globalData) if (!(key in globalObj)) delete this.globalData[key];
            for (const key in globalObj) this.globalData[key] = globalObj[key];
            this._logDebug('Global data updated:', this.globalData);
        } else console.warn('Spandrix: setGlobalData expects a non-null object.');
    }

    registerComponent(name, definition) {
        if (!name || !definition || !definition.template) { console.error("Spandrix: Invalid component definition for", name, ". Must have name and template."); return; }
        const lowerCaseName = name.toLowerCase();
        const propsDef = {};
        if (definition.props) {
            if (Array.isArray(definition.props)) {
                definition.props.forEach(pName => propsDef[this._camelCase(pName)] = { type: null }); // Default type if just array of names
            } else { // Object definition
                for (const pName in definition.props) {
                    const normalizedPName = this._camelCase(pName);
                    propsDef[normalizedPName] = (typeof definition.props[pName] === 'object' && definition.props[pName] !== null && ('type' in definition.props[pName] || 'default' in definition.props[pName]))
                        ? definition.props[pName]
                        : { type: definition.props[pName] }; // Normalize to object form
                }
            }
        }
        this.components[lowerCaseName] = { ...definition, _name: lowerCaseName, _propsDef: propsDef };
        this._logDebug(`Registered component: <${lowerCaseName}>`);
    }

    registerFilter(name, filterFn) {
        if (typeof filterFn === 'function') this.filters[name] = filterFn;
        else console.error(`Spandrix: Filter "${name}" must be a function.`);
        this._logDebug(`Registered filter: "${name}"`);
    }

    _getValueByPath(obj, path) {
        if (path === '.' || path === undefined || path === null || typeof path !== 'string' || path.trim() === '') return obj;
        return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' && key in acc) ? acc[key] : undefined, obj);
    }

    _setValueByPath(obj, path, value) {
        if (typeof path !== 'string' || path.trim() === '') { this._logDebug('_setValueByPath: Invalid path.', path); return false; }
        const keys = path.split('.');
        const lastKey = keys.pop();
        let current = obj;
        for (const key of keys) {
            if (!current[key] || typeof current[key] !== 'object') current[key] = {}; // Create path if not exists
            current = current[key];
        }
        current[lastKey] = value;
        return true;
    }

    _sanitizeHTML(input) {
        if (typeof input !== 'string') return String(input ?? ''); // Handle null/undefined gracefully
        const temp = document.createElement('div');
        temp.textContent = input;
        return temp.innerHTML;
    }

    _parseFilterCall(filterCallStr, evaluationContext) {
        const parts = filterCallStr.split(':').map(s => s.trim());
        const name = parts[0];
        const args = parts.slice(1).map(argStr => {
            // Try to evaluate argStr as literal or path
            if ((argStr.startsWith("'") && argStr.endsWith("'")) || (argStr.startsWith('"') && argStr.endsWith('"'))) return argStr.slice(1, -1); // String literal
            const num = parseFloat(argStr); if (!isNaN(num) && isFinite(argStr)) return num; // Number literal
            if (argStr === 'true') return true; if (argStr === 'false') return false; // Boolean literals
            if (argStr === 'null') return null; if (argStr === 'undefined') return undefined; // Null/Undefined literals
            if (argStr === '$state') return this.$state; // Special $state keyword
            if (argStr.startsWith('$state.')) return this._getValueByPath(this.$state, argStr.substring('$state.'.length)); // Path within $state
            // Try to resolve from evaluationContext (component data, props, loop vars, globalData)
            const valFromCtx = this._getValueByPath(evaluationContext, argStr);
            if (valFromCtx !== undefined) return valFromCtx;
            // Fallback: check globalData directly if not in evaluationContext (though usually it is)
            if (this.globalData && argStr in this.globalData) return this.globalData[argStr];
            // If not resolved, could be an intended undefined or a missing variable
            return undefined;
        });
        return { name, args };
    }

    _buildScopedEvaluator(expression, baseDataContext, componentInstance, additionalScope = {}) {
        if (!expression || typeof expression !== 'string' || expression.trim() === '') return () => undefined;

        const engine = this;
        const contextKeyNames = new Set(); // To store unique keys for the Function constructor
        const contextValueProviders = new Map(); // To store functions that provide the current value for each key

        // Helper to add a key and its value provider
        const addKeyFromProvider = (keyName, valueProvider) => {
        // Ensure key is a valid JS identifier and not already added
        if (!contextKeyNames.has(keyName) && /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(keyName)) {
            contextKeyNames.add(keyName);
            contextValueProviders.set(keyName, valueProvider);
        }
        };

        // 1. Add keys from additionalScope (e.g., loop variables like item, $index)
        if (additionalScope) {
        for (const key in additionalScope) {
            if (Object.prototype.hasOwnProperty.call(additionalScope, key)) {
            addKeyFromProvider(key, () => additionalScope[key]);
            }
        }
        }

        // 2. Add keys from component instance context (props, data, computed, methods)
        if (componentInstance && componentInstance._templateContext) {
        const compCtx = componentInstance._templateContext; // This is the proxy that resolves these
        const compDef = componentInstance._componentDef;
        if (compDef) {
            // Props
            if (compDef._propsDef) Object.keys(compDef._propsDef).forEach(p => addKeyFromProvider(p, () => compCtx[p]));
            // Data
            if (componentInstance._componentData) Object.keys(componentInstance._componentData).forEach(d => addKeyFromProvider(d, () => compCtx[d]));
            // Computed (these are getters on the _templateContext proxy)
            if (compDef.computed) Object.keys(compDef.computed).forEach(c => addKeyFromProvider(c, () => compCtx[c]));
            // Methods (these are bound functions on the _templateContext proxy)
            if (compDef.methods) Object.keys(compDef.methods).forEach(m => addKeyFromProvider(m, () => compCtx[m]));
            // Re-iterate computed, as they might depend on data/props already added.
            // The proxy handles the actual value resolution.
            if (compDef.computed) {
            Object.keys(compDef.computed).forEach(computedKey => {
                addKeyFromProvider(computedKey, () => compCtx[computedKey]); // Access via proxy
            });
        }
        }
        }

        // 3. Add keys from baseDataContext (e.g., root data if not in a component)
        if (baseDataContext) {
        // This context is typically engine._currentRootData or a non-component scope
        for (const key in baseDataContext) {
            // Avoid adding internal reactive proxy properties
            if (key !== '_isReactiveProxy' && Object.prototype.hasOwnProperty.call(baseDataContext, key)) {
            addKeyFromProvider(key, () => baseDataContext[key]);
            }
        }
        }

        // 4. Add global Spandrix objects
        if (engine.globalData) {
        for (const key in engine.globalData) {
            if (Object.prototype.hasOwnProperty.call(engine.globalData, key)) {
            addKeyFromProvider(key, () => engine.globalData[key]);
            }
        }
        }

        addKeyFromProvider('$state', () => engine.$state);
        addKeyFromProvider('globalData', () => engine.globalData); // Explicitly add globalData object itself
        // $route removed as router is removed
        // if (engine.router) addKeyFromProvider('$route', () => engine.router.getCurrentRoute());

        // Special case for parentComponentInstance if expression needs it (rare)
        if (expression.includes('parentComponentInstance')) { // This is a bit of a hack, use with caution
            addKeyFromProvider('parentComponentInstance', () => componentInstance);
        }


        const finalKeys = Array.from(contextKeyNames);
        const debugCtx = componentInstance ? `<${componentInstance._componentDef._name}>` : (baseDataContext === engine._currentRootData ? 'RootData' : 'Other');
        engine._logDebug(`ScopedEvaluator for "${expression}" in context [${debugCtx}] with keys:`, finalKeys);

        try {
        // Basic check for obviously unsafe patterns. More robust sandboxing is complex.
        if (expression.includes('Function(') || expression.includes('eval(')) { // Basic guard
            console.warn(`Spandrix: Blocked unsafe expression: "${expression}"`);
            return () => undefined; // Return a function that yields undefined
        }
        const fn = new Function(...finalKeys, `return (${expression});`);
        return () => {
            try {
            const values = finalKeys.map(k => contextValueProviders.get(k)?.()); // Get current values
            return fn(...values);
            } catch (e) {
            if (engine.options.strictExpressions) throw e;
            // console.warn(`Spandrix: Error evaluating "${expression}":`, e.message, "with keys:", finalKeys, "and values:", finalKeys.map(k => contextValueProviders.get(k)?.()));
            return undefined; // Return undefined on evaluation error if not strict
            }
        };
        } catch (e) {
        console.error(`Spandrix: Compile error in expression "${expression}":`, e.message);
        return () => undefined; // Return a function that yields undefined on compile error
        }
    }


    _interpolateString(templateStr, dataContext, componentInstance = null, loopScope = {}) {
        if (typeof templateStr !== 'string') return String(templateStr ?? ''); // Handle null/undefined
        return templateStr.replace(/{{{([\s\S]*?)}}}|{{([\s\S]*?)}}/g, (_match, rawExpr, escapedExpr) => {
            const isRaw = !!rawExpr;
            let expressionAndFilters = (isRaw ? rawExpr : escapedExpr).trim();
            const parts = expressionAndFilters.split('|').map(s => s.trim());
            const expression = parts[0];
            const filterCalls = parts.slice(1);
            let value = this._buildScopedEvaluator(expression, dataContext, componentInstance, loopScope)();
            this._logDebug(`Interpolating expr "${expression}". Initial value:`, value, "in context:", dataContext === this._currentRootData ? "Root" : "Component/Other");

            // For filter arguments, the context should be comprehensive
            const filterArgEvalContext = {
                ...(componentInstance ? componentInstance._templateContext : {}), // Component's full scope
                ...dataContext, // Base data (e.g., root data)
                ...loopScope,   // Loop variables
                ...this.globalData, // Global data
                $state: this.$state // Global state
            };

            for (const filterCallStr of filterCalls) {
                const { name: filterName, args: filterArgs } = this._parseFilterCall(filterCallStr, filterArgEvalContext);
                if (this.filters?.[filterName]) {
                    try { value = this.filters[filterName](value, ...filterArgs); }
                    catch (e) { console.error(`Spandrix: Error in filter "${filterName}" for "${expression}":`, e); }
                } else console.warn(`Spandrix: Filter "${filterName}" not found.`);
            }

            if (isRaw) {
                if (!this.options.allowRawHTML) {
                    console.warn(`Spandrix: Raw HTML interpolation disabled for expression: {{{ ${expression} }}}`);
                    return this.options.missingValuePlaceholder;
                }
                return String(value ?? ''); // Handle null/undefined for raw output
            }
            // For escaped expressions, handle object stringification and null/undefined
            const stringValue = (value === undefined || value === null)
                ? this.options.missingValuePlaceholder
                : (typeof value === 'object' ? JSON.stringify(value) : String(value));
            return this._sanitizeHTML(stringValue);
        });
    }

    _evaluateCondition(expression, dataContext, componentInstance, additionalScope = {}) {
        const result = this._buildScopedEvaluator(expression, dataContext, componentInstance, additionalScope)();
        this._logDebug(`Evaluated condition "${expression}", result:`, result);
        return !!result; // Coerce to boolean
    }

    _createEventHandler(element, handlerExpression, dataContext, componentInstance, loopScope = {}) {
        // Regex to parse: functionName(arg1, arg2, ...) or just functionName
        const match = handlerExpression.match(/^([\w$.]+)(?:\(([\s\S]*)\))?$/);
        if (!match) { console.warn(`Spandrix: Invalid event handler expression: "${handlerExpression}"`); return null; }

        const handlerNameOrPath = match[1]; // e.g., 'myMethod', 'obj.method'
        const argsString = match[2] || "";   // e.g., "'stringArg', varArg, $event"

        // Get the handler function itself using the scoped evaluator
        // This resolves whether handlerNameOrPath is a method on component, root data, etc.
        const getHandlerFn = this._buildScopedEvaluator(handlerNameOrPath, dataContext, componentInstance, loopScope);

        return (event) => {
            const handlerFnInstance = getHandlerFn(); // Evaluate to get the actual function at call time
            if (typeof handlerFnInstance !== 'function') {
                console.warn(`Spandrix: Event handler "${handlerNameOrPath}" not found or not a function in the current scope.`);
                return;
            }
            // Prepare a context for evaluating arguments, including $event and loop scope
            const argEvalContext = { ...loopScope, '$event': event };
            const resolvedArgs = argsString.split(',')
                .map(arg => arg.trim())
                .filter(arg => arg) // Remove empty strings if argsString is empty or has trailing commas
                .map(argStr => {
                    if (argStr === '$event') return event; // Special $event keyword
                    // Evaluate other arguments in the combined scope
                    return this._buildScopedEvaluator(argStr, dataContext, componentInstance, argEvalContext)();
                });

            try {
                // Determine the 'this' context for the method call
                let methodOwnerContext = componentInstance ? componentInstance._templateContext : dataContext;
                // If handlerNameOrPath is a path like 'obj.method', 'this' should be 'obj'
                if (handlerNameOrPath.includes('.')) {
                    const pathParts = handlerNameOrPath.split('.');
                    pathParts.pop(); // Remove the method name itself
                    if (pathParts.length > 0) {
                        // Evaluate the object path to get the correct 'this'
                        methodOwnerContext = this._buildScopedEvaluator(pathParts.join('.'), dataContext, componentInstance, loopScope)();
                    }
                }
                handlerFnInstance.apply(methodOwnerContext, resolvedArgs);
            } catch (e) {
                console.error(`Spandrix: Error executing event handler "${handlerNameOrPath}":`, e, "Args:", resolvedArgs);
            }
        };
    }

    _cleanupEventListenersBoundWithin(hostElementOrComponentId) {
        if (!this._eventListeners) return;
        const isId = typeof hostElementOrComponentId === 'string';
        this._eventListeners = this._eventListeners.filter(({ element, type, handler, componentId }) => {
            const match = isId
                ? (componentId === hostElementOrComponentId) // Match by component ID
                : (hostElementOrComponentId === element || hostElementOrComponentId.contains(element)); // Match by element or its descendants

            if (match) {
                element.removeEventListener(type, handler);
                this._logDebug('Cleaned event listener on', element, type, 'for/within', hostElementOrComponentId);
                return false; // Remove from list
            }
            return true; // Keep in list
        });
    }

    _cleanupAllEventListeners() {
        this._logDebug('Cleaning up ALL event listeners. Count:', this._eventListeners.length);
        this._eventListeners.forEach(({ element, type, handler }) => {
            if (element && typeof element.removeEventListener === 'function') {
                element.removeEventListener(type, handler);
            }
        });
        this._eventListeners = [];
    }

    _callHook(hookName, context, ...args) {
        if (this._hooks[hookName]) {
            this._hooks[hookName].forEach(hookFn => {
                try { hookFn.call(context || this, ...args); } // Default to engine instance if no context
                catch (e) { console.error(`Spandrix: Error in hook '${hookName}':`, e); }
            });
        }
    }

    _extractKeysFromExpression(expression) {
        const keys = new Set();
        // Regex to find potential variable names. This is a simplification and might not be perfect for all JS syntax.
        // It looks for words that are not keywords and not part of a property access like `obj.key`.
        const varRegex = /(?<!\.)\b([a-zA-Z$_][\w$]*)\b(?!\s*\()/g; // Avoids function calls like `myFunc()`
        let match;
        while ((match = varRegex.exec(expression)) !== null) {
            const potentialKey = match[1];
            // Exclude common keywords, literals, and special Spandrix variables
            if (!['true', 'false', 'null', 'undefined', 'in', 'of', 'NaN', 'Infinity',
                  '$state', 'globalData', '$event', '$index', 'item', 'key', 'value', // Common loop/event vars
                  // Also exclude known filter names to avoid treating them as reactive dependencies
                  ...(Object.keys(this.filters || {}))].includes(potentialKey) &&
                !/^\d/.test(potentialKey)) { // Exclude numbers
                keys.add(potentialKey);
            }
        }
        this._logDebug(`Key extraction from expression: "${expression}" -> Result:`, Array.from(keys));
        return Array.from(keys);
    }


    _processIfDirective(el, conditionExpr, dataContext, componentInstance, loopScope = {}, parentFragment = null) {
        const currentParent = el.parentNode || parentFragment; // Determine the actual parent for DOM operations
        if (!currentParent) {
            this._logDebug(`data-if on <${el.tagName}> for expr "${conditionExpr}" has no effective parent. Directive cannot operate.`);
            return el; // Return original element if no parent context
        }

        // Use or create a placeholder comment node
        if (!el._spxIfPlaceholderNode) el._spxIfPlaceholderNode = document.createComment(`spx-if: ${conditionExpr} (id: ${this._generateComponentId()})`);
        const placeholder = el._spxIfPlaceholderNode;
        // Store the original template of the element if not already stored
        if (!el._spxIfOriginalTemplateNode) {
            el._spxIfOriginalTemplateNode = el.cloneNode(true);
            el._spxIfOriginalTemplateNode.removeAttribute('data-if'); // Remove data-if from template
        }

        const evaluator = this._buildScopedEvaluator(conditionExpr, dataContext, componentInstance, loopScope);
        let returnedNode = el; // Node to return (either el or placeholder)

        const updateIfBlock = () => {
            const shouldBeVisible = evaluator();
            // Check current state in DOM
            const isActualElementInParent = el.parentNode === currentParent || (parentFragment && Array.from(parentFragment.childNodes).includes(el));
            const isPlaceholderInParent = placeholder.parentNode === currentParent || (parentFragment && Array.from(parentFragment.childNodes).includes(placeholder));

            if (shouldBeVisible) {
                if (isPlaceholderInParent) { // If placeholder is there, replace with fresh element
                    const freshElement = el._spxIfOriginalTemplateNode.cloneNode(true);
                    // Carry over internal properties
                    freshElement._spxIfPlaceholderNode = placeholder;
                    freshElement._spxIfOriginalTemplateNode = el._spxIfOriginalTemplateNode;
                    freshElement._spxIfWatchersAttached = el._spxIfWatchersAttached; // Preserve watcher status

                    currentParent.replaceChild(freshElement, placeholder);
                    this._processNode(freshElement, dataContext, componentInstance, loopScope, parentFragment); // Process the new element
                    returnedNode = freshElement;
                } else if (!isActualElementInParent && currentParent) { // If neither is there, append fresh element
                    const freshElement = el._spxIfOriginalTemplateNode.cloneNode(true);
                    freshElement._spxIfPlaceholderNode = placeholder;
                    freshElement._spxIfOriginalTemplateNode = el._spxIfOriginalTemplateNode;
                    const targetAppendParent = parentFragment || currentParent; // Prefer fragment if available
                    targetAppendParent.appendChild(freshElement);
                    this._processNode(freshElement, dataContext, componentInstance, loopScope, parentFragment);
                    returnedNode = freshElement;
                } else if (isActualElementInParent) { // If element is already there, re-process its children
                    Array.from(el.childNodes).forEach(child => this._processNode(child, dataContext, componentInstance, loopScope, parentFragment || el));
                    returnedNode = el;
                }
            } else { // Should be hidden
                if (isActualElementInParent) { // If element is there, replace with placeholder
                    this._cleanupEventListenersBoundWithin(el); // Clean up listeners on the element being removed
                    currentParent.replaceChild(placeholder, el);
                    returnedNode = placeholder;
                } else if (!isPlaceholderInParent && currentParent) { // If neither is there, append placeholder
                     currentParent.appendChild(placeholder);
                     returnedNode = placeholder;
                } else { // Placeholder is already there or no parent
                    returnedNode = placeholder;
                }
            }
        };

        // Setup watchers only once
        if (!el._spxIfWatchersAttached) {
            const reactiveKeys = this._extractKeysFromExpression(conditionExpr);
            reactiveKeys.forEach(key => {
                if (componentInstance) { // If inside a component, watch component's context
                    this._addWatcher(componentInstance, key, updateIfBlock);
                } else if (dataContext === this._currentRootData) { // If at root level, changes to _currentRootData trigger re-render anyway
                    // No explicit watcher needed here as root re-render will re-evaluate the 'if'
                    // However, for fine-grained updates without full root re-render, one might be added.
                    // For now, relying on root re-render triggered by _currentRootData changes.
                }
                // TODO: Consider watchers for globalData or $state if used in conditionExpr outside components
            });
            el._spxIfWatchersAttached = true;
        }

        updateIfBlock(); // Initial run
        return returnedNode;
    }

    _processNode(node, dataContext, componentInstance = null, currentLoopScope = {}, parentFragment = null) {
        // Create a signature for the current processing context to avoid redundant processing
        // This helps if the same node is visited with the exact same data context and loop scope.
        const newProcessingSignature = JSON.stringify({
            dataContextIdentity: dataContext === this._currentRootData ? 'root' : (componentInstance ? componentInstance._componentId : 'other'),
            loopScope: currentLoopScope // Compare loop scope values
        });

        // If node was already processed with the exact same context and is still in DOM, skip deep processing.
        // This is a basic optimization. More complex scenarios might need finer-grained checks.
        if (node._spxProcessedSignature === newProcessingSignature && node.parentNode) {
            // Even if signature matches, children might need updates if their own contexts changed.
            // However, for this node's direct attributes and directives, it's likely up-to-date.
            // For now, we'll return, but this could be refined.
            return node;
        }
        // Clear signature for non-elements or if context changes
        if (node.nodeType !== Node.ELEMENT_NODE) node._spxProcessedSignature = null;


        let currentNodeToProcess = node; // This might be replaced by a placeholder (e.g., from data-if)

        if (currentNodeToProcess.nodeType === Node.ELEMENT_NODE) {
            // 1. Handle data-if first, as it can replace the element with a comment
            const ifAttr = currentNodeToProcess.getAttribute('data-if');
            if (ifAttr) {
                currentNodeToProcess = this._processIfDirective(currentNodeToProcess, ifAttr, dataContext, componentInstance, currentLoopScope, parentFragment);
                // If data-if resulted in a comment node (element hidden), no further processing on this path
                if (currentNodeToProcess.nodeType === Node.COMMENT_NODE) {
                    currentNodeToProcess._spxProcessedSignature = newProcessingSignature; // Mark placeholder as processed for this context
                    return currentNodeToProcess;
                }
            }

            // 2. Check if it's a registered component
            const tagName = currentNodeToProcess.tagName.toLowerCase();
            const componentDef = this.components[tagName];
            if (componentDef) {
                this._renderComponent(currentNodeToProcess, tagName, dataContext, componentInstance, currentLoopScope);
                currentNodeToProcess._spxProcessedSignature = newProcessingSignature; // Mark component host as processed
                return currentNodeToProcess; // Component rendering handles its own children
            }

            // 3. Handle data-repeat (structural directive, processes template for each item)
            if (currentNodeToProcess.hasAttribute('data-repeat')) {
                this._processRepeatDirective(currentNodeToProcess, dataContext, componentInstance, currentLoopScope, parentFragment);
                // data-repeat replaces the node with an anchor and appends clones.
                // Return the anchor or the original node if it became an anchor.
                const anchor = currentNodeToProcess._spxRepeatAnchor || currentNodeToProcess;
                anchor._spxProcessedSignature = newProcessingSignature;
                return anchor;
            }

            // 4. Handle other directives and attribute bindings for regular elements
            const showAttr = currentNodeToProcess.getAttribute('data-show');
            if (showAttr) {
                currentNodeToProcess.style.display = this._evaluateCondition(showAttr, dataContext, componentInstance, currentLoopScope) ? '' : 'none';
            }

            // Process attributes (event handlers, bindings)
            Array.from(currentNodeToProcess.attributes).forEach(attr => {
                const { name: attrName, value: attrValue } = attr;
                if (attrName.startsWith('data-on:')) {
                    const eventType = attrName.slice('data-on:'.length);
                    // Avoid re-attaching same handler if element is re-processed (e.g. parent update)
                    if (!currentNodeToProcess._spx_event_listeners || !currentNodeToProcess._spx_event_listeners[eventType]) {
                        const eventHandlerFn = this._createEventHandler(currentNodeToProcess, attrValue, dataContext, componentInstance, currentLoopScope);
                        if (eventHandlerFn) {
                            currentNodeToProcess.addEventListener(eventType, eventHandlerFn);
                            this._eventListeners.push({ element: currentNodeToProcess, type: eventType, handler: eventHandlerFn, componentId: componentInstance ? componentInstance._componentId : null });
                            currentNodeToProcess._spx_event_listeners = currentNodeToProcess._spx_event_listeners || {};
                            currentNodeToProcess._spx_event_listeners[eventType] = eventHandlerFn; // Mark as attached
                        }
                    }
                } else if (attrName === 'data-model' && /^(INPUT|TEXTAREA|SELECT)$/.test(currentNodeToProcess.tagName)) {
                    this._processDataModel(currentNodeToProcess, attrValue, dataContext, componentInstance, currentLoopScope);
                } else if (attrName.startsWith(':') || attrName.startsWith('data-bind:')) {
                    const bindAttr = attrName.startsWith(':') ? attrName.slice(1) : attrName.slice('data-bind:'.length);
                    let val = this._buildScopedEvaluator(attrValue, dataContext, componentInstance, currentLoopScope)();

                    if (bindAttr === 'class') {
                        // Preserve static classes and manage dynamic ones
                        const staticClasses = currentNodeToProcess._spx_static_class ?? Array.from(currentNodeToProcess.classList).filter(c => !c.startsWith('spx-dynamic-')).join(' '); // Store initial static classes
                        currentNodeToProcess._spx_static_class = staticClasses; // Cache it
                        let dynamicClasses = '';
                        if (typeof val === 'string') dynamicClasses = val;
                        else if (Array.isArray(val)) dynamicClasses = val.join(' ');
                        else if (typeof val === 'object' && val !== null) dynamicClasses = Object.keys(val).filter(k => val[k]).join(' ');
                        currentNodeToProcess.className = (staticClasses + ' ' + dynamicClasses).trim().replace(/\s+/g, ' '); // Combine and clean
                    } else if (bindAttr === 'style') {
                        if (typeof val === 'object' && val !== null) { // Object syntax for styles
                            Object.keys(val).forEach(styleKey => currentNodeToProcess.style[this._camelCase(styleKey)] = val[styleKey]);
                        } else if (typeof val === 'string') { // String syntax for styles
                            currentNodeToProcess.style.cssText = val;
                        }
                    } else if (typeof val === 'boolean') { // Boolean attributes (e.g., disabled, checked)
                        val ? currentNodeToProcess.setAttribute(bindAttr, '') : currentNodeToProcess.removeAttribute(bindAttr);
                    } else if (val !== undefined && val !== null) { // Other attributes
                        currentNodeToProcess.setAttribute(bindAttr, String(val));
                    } else { // Remove attribute if value is null or undefined
                        currentNodeToProcess.removeAttribute(bindAttr);
                    }
                } else if (!attrName.startsWith('data-') && (attrValue.includes('{{') || attrValue.includes('{{{'))) { // Interpolation in attributes
                    const interpolatedValue = this._interpolateString(attrValue, dataContext, componentInstance, currentLoopScope);
                    if (currentNodeToProcess.getAttribute(attrName) !== interpolatedValue) { // Only set if changed
                        currentNodeToProcess.setAttribute(attrName, interpolatedValue);
                    }
                }
            });

            // Handle content directives (data-text, data-html) - these take over inner content
            if (currentNodeToProcess.hasAttribute('data-fetch')) this._processFetchDirective(currentNodeToProcess, dataContext, componentInstance, currentLoopScope);

            if (currentNodeToProcess.hasAttribute('data-text')) {
                currentNodeToProcess.textContent = this._interpolateString(`{{${currentNodeToProcess.getAttribute('data-text')}}}`, dataContext, componentInstance, currentLoopScope);
                currentNodeToProcess._spxProcessedSignature = newProcessingSignature; // Mark as processed
                return currentNodeToProcess; // No need to process children if data-text is used
            }
            if (currentNodeToProcess.hasAttribute('data-html')) {
                if (this.options.allowRawHTML) {
                    currentNodeToProcess.innerHTML = this._interpolateString(`{{{${currentNodeToProcess.getAttribute('data-html')}}}}`, dataContext, componentInstance, currentLoopScope);
                } else {
                    currentNodeToProcess.textContent = this.options.missingValuePlaceholder; // Sanitize if raw HTML not allowed
                    console.warn('Spandrix: data-html used but allowRawHTML is false. Content sanitized/placeholdered.');
                }
                currentNodeToProcess._spxProcessedSignature = newProcessingSignature; // Mark as processed
                return currentNodeToProcess; // No need to process children if data-html is used
            }
            if (currentNodeToProcess.hasAttribute('data-safe-html')) { // Assumes the source is trusted but still sanitizes for safety
                currentNodeToProcess.innerHTML = this._sanitizeHTML(this._interpolateString(`{{{${currentNodeToProcess.getAttribute('data-safe-html')}}}}`, dataContext, componentInstance, currentLoopScope));
                currentNodeToProcess._spxProcessedSignature = newProcessingSignature;
                return currentNodeToProcess;
            }
        }

        // 5. Process child nodes recursively (if not handled by a content directive like data-text/html)
        // This applies to regular elements or document fragments
        if (currentNodeToProcess.nodeType === Node.ELEMENT_NODE || currentNodeToProcess.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            const children = Array.from(currentNodeToProcess.childNodes); // Iterate over a static copy
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                let processedChild;

                if (child.nodeType === Node.TEXT_NODE && (child.nodeValue.includes('{{') || child.nodeValue.includes('{{{'))) {
                    child._spxProcessedSignature = null; // Text nodes always re-interpolate if they have markers
                    const originalValue = child.nodeValue;
                    const interpolated = this._interpolateString(originalValue, dataContext, componentInstance, currentLoopScope);
                    if (interpolated !== originalValue) { // Only update if changed
                         this._logDebug(`Updating text node from "${originalValue}" to "${interpolated}" for dataContext key (example from textValue):`, dataContext ? dataContext.textValue : 'N/A');
                        child.nodeValue = interpolated;
                    }
                    processedChild = child;
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    // Pass parentFragment if current node is a fragment, otherwise pass the original parentFragment context
                    processedChild = this._processNode(child, dataContext, componentInstance, currentLoopScope,
                                                       (currentNodeToProcess.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? currentNodeToProcess : parentFragment));
                } else {
                    processedChild = child; // Other node types (comments) are passed through
                }
                // If _processNode replaced a child (e.g., data-if), update it in the parent
                if (processedChild !== child && child.parentNode === currentNodeToProcess) {
                    currentNodeToProcess.replaceChild(processedChild, child);
                }
            }
        }
        currentNodeToProcess._spxProcessedSignature = newProcessingSignature; // Mark as processed for this context
        return currentNodeToProcess;
    }

    _processRepeatDirective(node, dataContext, componentInstance, parentLoopScope, parentFragmentContext = null) {
        const repeatExpr = node.getAttribute('data-repeat').trim();
        let itemVar = 'item', indexOrKeyVar = '$index', actualIndexVar = null, collectionExpr = repeatExpr;

        // Parse expression: (item, index) in collection OR item in collection
        const inMatch = repeatExpr.match(/^(.*?)\s+in\s+(.+)$/);
        if (!inMatch) { console.warn(`Spandrix data-repeat: Invalid expression "${repeatExpr}" on <${node.tagName}>`); return; }
        collectionExpr = inMatch[2].trim();
        const loopVarsStr = inMatch[1].trim().replace(/[()]/g, ''); // Remove parentheses if present
        const loopVars = loopVarsStr.split(',').map(v => v.trim());

        itemVar = loopVars[0];
        if (loopVars.length > 1) indexOrKeyVar = loopVars[1];
        if (loopVars.length > 2) actualIndexVar = loopVars[2]; // For (value, key, index) in object

        const items = this._buildScopedEvaluator(collectionExpr, dataContext, componentInstance, parentLoopScope)();
        const effectiveParent = node.parentNode || parentFragmentContext; // Determine actual parent for DOM ops
        if (!effectiveParent) { this._logDebug(`data-repeat on <${node.tagName}> for "${repeatExpr}" has no effective parent.`); return; }

        let templateElement, anchorNode = node._spxRepeatAnchor; // Anchor is a comment node

        if (!anchorNode) { // First time processing this repeat directive
            templateElement = node.cloneNode(true);
            templateElement.removeAttribute('data-repeat');
            templateElement.style.display = ''; // Ensure template is not hidden if original was
            anchorNode = document.createComment(`spx-repeat: ${repeatExpr} (id: ${this._generateComponentId()})`);
            effectiveParent.replaceChild(anchorNode, node); // Replace original node with anchor
            anchorNode._spxRepeatTemplate = templateElement; // Store template on anchor
            node._spxRepeatAnchor = anchorNode; // Link original node to anchor (though original is now detached)
        } else {
            templateElement = anchorNode._spxRepeatTemplate; // Retrieve stored template
        }

        // Clear previously rendered items for this anchor
        let currentSibling = anchorNode.nextSibling;
        while (currentSibling && currentSibling._spxRepeatItemFor === anchorNode) {
            const toRemove = currentSibling;
            currentSibling = currentSibling.nextSibling;
            this._cleanupEventListenersBoundWithin(toRemove); // Clean up listeners on removed items
            toRemove.remove();
        }

        if (!items || typeof items !== 'object' || Object.keys(items).length === 0) {
            this._logDebug(`data-repeat for "${collectionExpr}" resulted in empty or no items.`);
            return; // No items to render
        }

        const fragmentToInsert = document.createDocumentFragment(); // Efficiently append new items

        const processSingleItem = (itemValue, keyOrIndexValue, actualIndexValueIfObjectLoop) => {
            const clone = templateElement.cloneNode(true);
            const loopItemScope = { ...parentLoopScope }; // Inherit parent loop scope
            loopItemScope[itemVar] = itemValue;
            loopItemScope[indexOrKeyVar] = keyOrIndexValue;
            if (actualIndexVar && actualIndexValueIfObjectLoop !== undefined) {
                loopItemScope[actualIndexVar] = actualIndexValueIfObjectLoop;
            }
            clone._spxRepeatItemFor = anchorNode; // Mark clone as belonging to this repeat instance
            // Process the clone within its new loop scope, appending to the fragment
            this._processNode(clone, dataContext, componentInstance, loopItemScope, fragmentToInsert);
            fragmentToInsert.appendChild(clone);
        };

        if (Array.isArray(items)) {
            items.forEach((item, idx) => processSingleItem(item, idx));
        } else { // Iterate over object properties
            Object.keys(items).forEach((key, idx) => {
                if (Object.prototype.hasOwnProperty.call(items, key)) {
                    processSingleItem(items[key], key, idx); // (value, key, index)
                }
            });
        }
        effectiveParent.insertBefore(fragmentToInsert, anchorNode.nextSibling); // Insert all new items after anchor
    }

    _processDataModel(inputElement, modelKey, dataContext, componentInstance, loopScope = {}) {
        const resolvedModelPath = modelKey; // The path string from data-model attribute
        let targetObjectForUpdate; // The object whose property will be set (e.g., component data, $state)
        let baseContextForRead;    // The object from which the value is read (can be different if reading from props)
        let effectiveKey = resolvedModelPath; // The final key to use on targetObjectForUpdate/baseContextForRead

        // Determine target and base context based on modelKey prefix or component context
        if (resolvedModelPath.startsWith('$state.')) {
            targetObjectForUpdate = this.$state;
            baseContextForRead = this.$state;
            effectiveKey = resolvedModelPath.substring('$state.'.length);
        } else if (resolvedModelPath.startsWith('globalData.')) {
            targetObjectForUpdate = this.globalData;
            baseContextForRead = this.globalData;
            effectiveKey = resolvedModelPath.substring('globalData.'.length);
        } else if (componentInstance) {
            baseContextForRead = componentInstance._templateContext; // Read from component's reactive scope

            // Determine where to write updates
            if (loopScope && Object.prototype.hasOwnProperty.call(loopScope, resolvedModelPath)) {
                // Model path directly matches a loop variable (e.g., data-model="item.name" where item is from data-repeat="item in items")
                // This is tricky. We want to update the original item in the collection if possible.
                // For simple cases, loopScope[resolvedModelPath] might work if 'item' itself is the target.
                // If resolvedModelPath is 'item.name', we need to update 'item's 'name' property.
                // This requires careful handling of how loopScope items are structured and if they are reactive.
                targetObjectForUpdate = loopScope; // This might update a copy, not the original, depending on how loopScope is populated
                 console.warn(`Spandrix: data-model="${resolvedModelPath}" in a loop targets a loop variable. Two-way binding might not update the original collection item as expected without specific handling for reactive collection items.`);
            } else if (componentInstance._componentData && (resolvedModelPath in componentInstance._componentData || typeof componentInstance._componentDef.data === 'function')) {
                // Model path matches a key in component's data object
                targetObjectForUpdate = componentInstance._componentData;
            } else if (componentInstance.$props && resolvedModelPath in componentInstance.$props && componentInstance._componentDef.model?.prop === resolvedModelPath) {
                // Model path matches a prop defined in component's model option (for v-model like behavior on components)
                targetObjectForUpdate = null; // Signal to emit an event instead of direct mutation
            } else if (componentInstance.$props && resolvedModelPath in componentInstance.$props) {
                // Model path matches a prop NOT defined in model option. This is one-way binding.
                console.warn(`Spandrix: data-model="${resolvedModelPath}" on component <${componentInstance._componentDef._name}> targets a prop directly without a defined model. This is one-way. For two-way binding, define a model or use .sync.`);
                targetObjectForUpdate = null; // No update target
            }
             else {
                // Default: attempt to set on component data (might create new property if data is extensible)
                targetObjectForUpdate = componentInstance._componentData;
            }
        } else { // Root context (not in a component)
            baseContextForRead = dataContext;
            targetObjectForUpdate = dataContext; // Update the root data object directly
            effectiveKey = resolvedModelPath;
        }

        // Get current value and set input element's state
        let currentValue = this._getValueByPath(baseContextForRead, effectiveKey);

        if (inputElement.type === 'checkbox') inputElement.checked = !!currentValue;
        else if (inputElement.type === 'radio') inputElement.checked = (String(inputElement.value) === String(currentValue));
        else inputElement.value = (currentValue !== undefined && currentValue !== null) ? String(currentValue) : '';

        // Determine event type for listening to changes
        const eventName = (inputElement.tagName === 'SELECT' || inputElement.type === 'checkbox' || inputElement.type === 'radio') ? 'change' : 'input';

        // Remove old listener if one exists (e.g., element re-processed)
        if (inputElement._spx_data_model_handler) {
            inputElement.removeEventListener(inputElement._spx_data_model_event_type, inputElement._spx_data_model_handler);
            this._eventListeners = this._eventListeners.filter(l => l.handler !== inputElement._spx_data_model_handler); // Also remove from global list
        }

        // Define the event handler for updating the model
        const modelUpdateHandler = (event) => {
            let newValue;
            const targetInput = event.target;
            if (targetInput.type === 'checkbox') newValue = targetInput.checked;
            else if (targetInput.type === 'radio') { if (!targetInput.checked) return; newValue = targetInput.value; } // Only update if checked for radio
            else newValue = targetInput.value;

            // Type coercion: if original value was number/boolean, try to convert new value
            const originalValueAtPath = this._getValueByPath(baseContextForRead, effectiveKey);
            if (typeof originalValueAtPath === 'number' && !isNaN(parseFloat(newValue))) newValue = parseFloat(newValue);
            else if (typeof originalValueAtPath === 'boolean') newValue = (newValue === 'true' || newValue === true); // Handle string 'true'

            if (targetObjectForUpdate) {
                this._setValueByPath(targetObjectForUpdate, effectiveKey, newValue);
            } else if (componentInstance && componentInstance._componentDef.model && componentInstance._componentDef.model.prop === resolvedModelPath) {
                // If targetObjectForUpdate is null, it means we should emit an event (v-model on component)
                componentInstance.$emit(componentInstance._componentDef.model.event || `update:${resolvedModelPath}`, newValue);
            }
            // If no targetObjectForUpdate and not a component model, it's a one-way binding from prop, so no update.
        };

        inputElement.addEventListener(eventName, modelUpdateHandler);
        this._eventListeners.push({ element: inputElement, type: eventName, handler: modelUpdateHandler, componentId: componentInstance ? componentInstance._componentId : null });
        inputElement._spx_data_model_handler = modelUpdateHandler; // Store handler on element for cleanup
        inputElement._spx_data_model_event_type = eventName; // Store event type for cleanup
    }

    convertToSpandrixSyntax(template) {
        if (typeof template !== 'string') return template;
        let processedTemplate = template;
        // v-on / @ -> data-on:
        processedTemplate = processedTemplate.replace(/(?:\bv-on:([\w.-]+)=|@([\w.-]+)=)/g, (match, vOnEventName, atEventName) => `data-on:${vOnEventName || atEventName}=`);
        // v-bind / : -> data-bind:
        processedTemplate = processedTemplate.replace(/(?<![a-zA-Z0-9-_])(?:v-bind:|:)([\w.-]+)=/g, (match, attributeName) => `data-bind:${attributeName}=`);
        // v-if -> data-if
        processedTemplate = processedTemplate.replace(/\bv-if=/g, 'data-if=');
        // v-show -> data-show
        processedTemplate = processedTemplate.replace(/\bv-show=/g, 'data-show=');
        // v-for -> data-repeat
        processedTemplate = processedTemplate.replace(/\bv-for="([^"]*)"/g, (match, expression) => `data-repeat="${expression}"`);
        // v-model -> data-model
        processedTemplate = processedTemplate.replace(/\bv-model=/g, 'data-model=');
        // Note: This doesn't handle complex Vue slot syntax like v-slot or #. Spandrix uses a simpler `slot="name"` attribute.
        return processedTemplate;
    }

    _renderComponent(hostElement, tagName, parentDataContext, parentComponentInstanceContext, parentLoopScope = {}) {
        const componentDef = this.components[tagName]; if (!componentDef) return; // Should not happen if called correctly
        const existingInstance = hostElement._spandrixComponent;

        // --- Update existing component instance if props change ---
        if (existingInstance && existingInstance._componentDef._name === tagName) {
            const newPropsData = {}; const propsDefForUpdate = existingInstance._componentDef._propsDef || {};
            let modelPropKeyForUpdate = null; let modelValueFromParent = undefined; let modelAttrValue = null; // For model binding

            // Re-evaluate props from hostElement attributes
            for (const attr of Array.from(hostElement.attributes)) {
                let attrName = attr.name, attrValue = attr.value, propKey = '', isModel = false, resolvedPropValue;
                if (attrName === 'data-model' && componentDef.model) { // Check for data-model binding
                    isModel = true;
                    propKey = componentDef.model.prop || 'modelValue'; // Default model prop name
                    modelAttrValue = attrValue; // Path in parent to bind to
                    resolvedPropValue = this._buildScopedEvaluator(attrValue, parentDataContext, parentComponentInstanceContext, parentLoopScope)();
                    modelPropKeyForUpdate = propKey; modelValueFromParent = resolvedPropValue;
                } else if (attrName.startsWith(':') || attrName.startsWith('data-bind:')) { // Bound props
                    let tempKey = attrName.startsWith(':') ? attrName.slice(1) : attrName.slice('data-bind:'.length);
                    if (tempKey.endsWith('.sync')) tempKey = tempKey.slice(0, -5); // Handle .sync modifier
                    propKey = this._camelCase(tempKey);
                    resolvedPropValue = this._buildScopedEvaluator(attrValue, parentDataContext, parentComponentInstanceContext, parentLoopScope)();
                } else { // Static props (check against propsDefinition)
                    const camelName = this._camelCase(attrName);
                    if (camelName in propsDefForUpdate) { propKey = camelName; resolvedPropValue = attrValue; } // Static string value
                    else continue; // Not a declared prop
                }
                if (propKey && (propKey in propsDefForUpdate || (isModel && propKey === (componentDef.model?.prop || 'modelValue')))) {
                    newPropsData[propKey] = resolvedPropValue;
                }
            }
            // Apply defaults for missing props
            for (const key in propsDefForUpdate) if (newPropsData[key] === undefined && propsDefForUpdate[key].default !== undefined) {
                const def = propsDefForUpdate[key].default; newPropsData[key] = typeof def === 'function' ? def.call(null) : def;
            }

            let propsChanged = false;
            // Compare new props with existing instance props
            for (const key in newPropsData) if (JSON.stringify(existingInstance.$props[key]) !== JSON.stringify(newPropsData[key])) {
                existingInstance.$props[key] = newPropsData[key]; // Update reactive prop
                propsChanged = true;
            }
            // Check for props that were removed
            for (const key in existingInstance.$props) if (!(key in newPropsData) && key in propsDefForUpdate) { // Ensure it was a defined prop
                delete existingInstance.$props[key]; // This should trigger reactivity if $props is a proxy
                propsChanged = true;
            }

            if (propsChanged) existingInstance.$update(); // Trigger component re-render
            return; // Update done
        } else if (existingInstance) { // Different component type, destroy old one
            this._destroyComponent(existingInstance); hostElement._spandrixComponent = null;
        }

        // --- Create new component instance ---
        this._cleanupEventListenersBoundWithin(hostElement); // Clean listeners on host before new comp
        const propsDefinition = componentDef._propsDef || {}; const propsData = {}; const syncEventHandlers = [];
        let modelPropKey = null, modelParentPath = null; // For data-model on component

        // Parse props from host element attributes
        for (const attr of Array.from(hostElement.attributes)) {
            let attrName = attr.name, attrValue = attr.value, propKey = '', isSync = false, isModel = false, resolvedPropValue;
            if (attrName === 'data-model' && componentDef.model) { // data-model on component (like v-model)
                isModel = true;
                propKey = componentDef.model.prop || 'modelValue';
                modelParentPath = attrValue; // Path in parent scope to bind to
                modelPropKey = propKey; // Store the prop name used for model
                resolvedPropValue = this._buildScopedEvaluator(attrValue, parentDataContext, parentComponentInstanceContext, parentLoopScope)();
            } else if (attrName.startsWith(':') || attrName.startsWith('data-bind:')) { // Bound props
                let tempKey = attrName.startsWith(':') ? attrName.slice(1) : attrName.slice('data-bind:'.length);
                if (tempKey.endsWith('.sync')) { isSync = true; tempKey = tempKey.slice(0, -5); }
                propKey = this._camelCase(tempKey);
                resolvedPropValue = this._buildScopedEvaluator(attrValue, parentDataContext, parentComponentInstanceContext, parentLoopScope)();
            } else { // Static props
                const camelName = this._camelCase(attrName);
                if (camelName in propsDefinition) { propKey = camelName; resolvedPropValue = attrValue; } // Static string
                else continue;
            }

            // If it's a valid prop, store it
            if (propKey && (propKey in propsDefinition || (isModel && propKey === (componentDef.model?.prop || 'modelValue')))) {
                propsData[propKey] = resolvedPropValue;
                // Setup .sync or model event listeners
                if (isSync || isModel) {
                    const eventToListen = isModel ? (componentDef.model.event || `update:${propKey}`) : `update:${propKey}`;
                    syncEventHandlers.push({
                        eventName: eventToListen,
                        parentPropertyPath: isModel ? modelParentPath : attrValue, // The path in parent to update
                        parentContextForUpdate: parentComponentInstanceContext ? parentComponentInstanceContext._componentData : parentDataContext,
                        isParentComponent: !!parentComponentInstanceContext // Is parent a component or root data?
                    });
                }
            }
        }
        // Apply default prop values
        for (const key in propsDefinition) if (propsData[key] === undefined && propsDefinition[key].default !== undefined) {
            const def = propsDefinition[key].default; propsData[key] = typeof def === 'function' ? def.call(null) : def;
        }

        const componentId = this._generateComponentId(); hostElement.setAttribute('data-spx-id', componentId);
        const componentInstance = {
            _isComponentInstance: true, _componentDef: componentDef, _componentId: componentId, _hostElement: hostElement, $el: hostElement,
            _parentDataContext: parentDataContext, _parentComponentInstance: parentComponentInstanceContext, _parentLoopScope: parentLoopScope,
            _watchers: [], _computedWatchers: {}, _computedValuesCache: {}, _mounted: false, _destroyed: false,
            $props: null, _componentData: null, $refs: {}, $slots: {}, $engine: this,
            // $route: this.router ? this.router.getCurrentRoute() : null, // Router removed
            $emit: (event, ...detail) => {
                if (componentInstance._destroyed) return;
                const customEvent = new CustomEvent(event, { detail: detail.length === 1 ? detail[0] : detail, bubbles: true, composed: true });
                componentInstance.$el.dispatchEvent(customEvent);
            },
            $update: () => { // Method to manually trigger component re-render
                if (componentInstance._destroyed || !componentInstance._mounted) return;
                this._logDebug(`<${componentDef._name}> (ID ${componentId}) $update() called.`);
                this._callHook('beforeComponentUpdate', componentInstance._templateContext, componentInstance);
                this._updateComputedProperties(componentInstance); // Re-calculate computed before render
                this._cleanupEventListenersBoundWithin(componentId); // Clean listeners within this component's old DOM

                const contentFragment = this._compileComponentTemplate(componentInstance);
                // Slot processing is now part of _compileComponentTemplate for greater accuracy

                componentInstance.$el.innerHTML = ''; // Clear old content
                componentInstance.$el.appendChild(contentFragment); // Append new content
                this._callHook('afterComponentUpdate', componentInstance._templateContext, componentInstance);
            },
            $watch: (path, cb) => this._addWatcher(componentInstance, path, cb), // Add a watcher
            $destroy: () => this._destroyComponent(componentInstance) // Destroy the component
        };
        hostElement._spandrixComponent = componentInstance; // Link instance to host element

        // Capture and process slots from original host element content
        componentInstance.$slots = this._captureAndProcessSlots(hostElement, parentDataContext, parentComponentInstanceContext, parentLoopScope);

        // Attach .sync / model event listeners
        if (hostElement._spxSyncListeners) hostElement._spxSyncListeners.forEach(l => hostElement.removeEventListener(l.event, l.handler)); // Clean old ones
        hostElement._spxSyncListeners = [];
        syncEventHandlers.forEach(syncInfo => {
            const handler = (event) => { // Event is CustomEvent, detail is the new value
                const newValue = event.detail;
                const path = syncInfo.parentPropertyPath;
                let updateTargetContext = syncInfo.parentContextForUpdate;

                // Determine where to write the updated value in the parent scope
                if (path.startsWith('$state.')) this.setState(path.substring('$state.'.length), newValue);
                else if (path.startsWith('globalData.')) this.globalData[path.substring('globalData.'.length)] = newValue;
                else if (syncInfo.isParentComponent && updateTargetContext) this._setValueByPath(updateTargetContext, path, newValue); // Parent is component
                else if (!syncInfo.isParentComponent && parentDataContext) this._setValueByPath(parentDataContext, path, newValue); // Parent is root data
            };
            componentInstance.$el.addEventListener(syncInfo.eventName, handler);
            hostElement._spxSyncListeners.push({ event: syncInfo.eventName, handler });
        });

        // Make $props reactive
        componentInstance.$props = this._makeReactive(propsData, (target, key, value, oldValue) => {
            this._logDebug(`<${tagName}> prop changed: ${String(key)}`, oldValue, '->', value);
            this._updateComputedProperties(componentInstance); // Props change can affect computed
            if (componentDef.watch?.[key]) componentDef.watch[key].call(componentInstance._templateContext, value, oldValue); // Call prop watcher
            if (componentInstance._mounted) componentInstance.$update(); // Re-render if mounted
        }, `<${tagName}>.$props`);

        // Initialize and make component's own data reactive
        const initialData = typeof componentDef.data === 'function' ? (componentDef.data.call(componentInstance /* pass raw instance first */) || {}) : {};
        componentInstance._componentData = this._makeReactive(initialData, (target, key, value, oldValue) => {
            this._logDebug(`<${tagName}> data changed: ${String(key)}`, oldValue, '->', value);
            this._updateComputedProperties(componentInstance); // Data change can affect computed
            // Trigger explicit $watchers for this data property
            componentInstance._watchers.forEach(w => {
                if (w.path === key || w.path.startsWith(key + '.')) { // Simple path match
                    const currentVal = this._getValueByPath(componentInstance._templateContext, w.path); // Get value via context
                    if(JSON.stringify(currentVal) !== JSON.stringify(w.oldValue)) { // Deep compare
                        w.callback.call(componentInstance._templateContext, currentVal, w.oldValue);
                        w.oldValue = JSON.parse(JSON.stringify(currentVal)); // Update old value for next change
                    }
                }
            });
            if (componentDef.watch?.[key]) componentDef.watch[key].call(componentInstance._templateContext, value, oldValue); // Call data watcher
            if (componentInstance._mounted) componentInstance.$update(); // Re-render if mounted
        }, `<${tagName}>._componentData`);

        // Create the _templateContext proxy for accessing props, data, methods, computed etc.
        const methodCache = {}; // Cache bound methods for performance
        componentInstance._templateContext = new Proxy(componentInstance, {
            get: (target, key) => {
                if (key === '_isReactiveProxy' || typeof key === 'symbol') return Reflect.get(target, key); // Internal proxy checks

                // Direct access to core instance properties
                if (['_isComponentInstance', '_componentDef', '_componentId', '_hostElement', '_parentDataContext', '_parentComponentInstance', '_parentLoopScope', '_watchers', '_computedWatchers', '_computedValuesCache', '_mounted', '_destroyed', '_componentData'].includes(String(key))) return target[key];
                // Access to public API methods/properties
                if (['$el', '$props', '$slots', '$refs', '$engine', '$emit', '$watch', '$destroy', '$update'].includes(String(key))) return target[key];

                // Global Spandrix objects
                if (String(key) === '$state') return target.$engine.$state;
                // $route removed
                // if (String(key) === '$route' && target.$engine.router) return target.$engine.router.getCurrentRoute();
                if (String(key) === 'globalData') return target.$engine.globalData;


                // Component-defined members
                if (componentDef.methods && key in componentDef.methods) {
                    // Cache bound methods
                    return methodCache[key] || (methodCache[key] = componentDef.methods[key].bind(target._templateContext));
                }
                if (componentDef.computed && key in componentDef.computed) {
                    // Ensure computed value is fresh before returning
                    if (!target._computedWatchers[key]?.isFresh) target.$engine._updateComputedProperties(target, String(key));
                    return target._computedValuesCache[key];
                }
                if (target._componentData && key in target._componentData) return target._componentData[key];
                if (target.$props && key in target.$props) return target.$props[key];

                // Fallback to parent loop scope or global data for convenience (read-only access)
                if (target._parentLoopScope && key in target._parentLoopScope) return target._parentLoopScope[key];
                if (target.$engine.globalData && key in target.$engine.globalData) return target.$engine.globalData[key];

                return undefined;
            },
            set: (target, key, value) => {
                if (typeof key === 'symbol') return Reflect.set(target, key, value); // Allow symbols

                // Set component data
                if (target._componentData && (key in target._componentData || typeof componentDef.data === 'function')) { // Check if key is a data prop
                    target._componentData[key] = value; return true;
                }
                // Warn against direct prop mutation
                if (target.$props && key in target.$props) {
                    console.warn(`Spandrix: Attempted to set prop "${String(key)}" on <${componentDef._name}>. Props are one-way. Use data properties or emit events.`); return false;
                }
                // Allow setting parent loop scope variables (use with caution, might not be reactive in parent)
                if (target._parentLoopScope && key in target._parentLoopScope && typeof target._parentLoopScope[key] === 'object' && target._parentLoopScope[key] !== null) {
                    target._parentLoopScope[key] = value; return true;
                }
                // Allow setting $state properties directly (will trigger reactivity)
                if (target.$engine.$state && key in target.$engine.$state) { // Check if key exists on $state to avoid accidental creation
                    target.$engine.$state[key] = value; return true;
                }
                // Fallback: set on the instance itself (e.g., for internal properties not covered above)
                target[key] = value; return true;
            },
            has: (target, key) => { // For 'in' operator checks
                if (key in target) return true; // Check instance properties
                if (componentDef.methods && key in componentDef.methods) return true;
                if (componentDef.computed && key in componentDef.computed) return true;
                if (target._componentData && key in target._componentData) return true;
                if (target.$props && key in target.$props) return true;
                if (target._parentLoopScope && key in target._parentLoopScope) return true;
                if (String(key) === '$state' /* || String(key) === '$route' */ || String(key) === 'globalData') return true; // Router check removed
                if (target.$engine.globalData && key in target.$engine.globalData) return true;
                return false;
            }
        });
        // If data is a function, call it with the fully formed _templateContext now
        if (typeof componentDef.data === 'function') {
            const newData = componentDef.data.call(componentInstance._templateContext) || {};
            for (const dataKey in newData) componentInstance._componentData[dataKey] = newData[dataKey]; // Populate reactive data
        }

        // Initialize computed properties
        if (componentDef.computed) {
            for (const key in componentDef.computed) {
                const getter = (typeof componentDef.computed[key] === 'function') ? componentDef.computed[key] : componentDef.computed[key].get; // Handle object syntax for computed
                componentInstance._computedWatchers[key] = {
                    fn: getter,
                    isFresh: false, // Mark as not yet calculated
                    dependencies: this._extractKeysFromExpression(getter.toString()) // Basic dependency tracking
                };
            }
            this._updateComputedProperties(componentInstance); // Initial calculation
        }

        // Lifecycle: Created
        this._callHook('beforeComponentCreate', componentInstance._templateContext, componentInstance);
        if (componentDef.created) try { componentDef.created.call(componentInstance._templateContext); } catch(e) { console.error(`Error in <${tagName}> created():`, e); }
        this._callHook('afterComponentCreate', componentInstance._templateContext, componentInstance);

        // Compile and render template
        const contentFragment = this._compileComponentTemplate(componentInstance);
        hostElement.innerHTML = ''; // Clear original host content (slots are captured)
        hostElement.appendChild(contentFragment);

        // Lifecycle: Mounted (async to ensure DOM attachment)
        this._callHook('beforeComponentMount', componentInstance._templateContext, componentInstance);
        Promise.resolve().then(() => {
            if (!componentInstance._destroyed && document.body.contains(hostElement)) { // Check if still valid and in DOM
                componentInstance._mounted = true;
                if (componentDef.mounted) try { componentDef.mounted.call(componentInstance._templateContext); } catch(e) { console.error(`Error in <${tagName}> mounted():`, e); }
                this._callHook('afterComponentMount', componentInstance._templateContext, componentInstance);
            }
        });
    }

    _captureAndProcessSlots(hostElement, parentDataContext, parentComponentInstance, parentLoopScope) {
        const capturedSlots = { default: [] }; // Initialize with a default slot array
        const tempFragmentForOriginalContent = document.createDocumentFragment();
        // Move all children of hostElement to a temporary fragment to preserve them
        while (hostElement.firstChild) {
            tempFragmentForOriginalContent.appendChild(hostElement.firstChild);
        }
        this._logDebug('Capturing slots for component. Original host content:', tempFragmentForOriginalContent.textContent.trim().substring(0,100));

        Array.from(tempFragmentForOriginalContent.childNodes).forEach(originalNode => {
            // Skip empty text nodes often found between elements
            if (originalNode.nodeType === Node.TEXT_NODE && originalNode.nodeValue.trim() === '') {
                return;
            }

            let slotName = 'default';
            let isTemplateSlotSyntax = false; // For <template slot="name"> or <template #name>

            if (originalNode.nodeType === Node.ELEMENT_NODE) {
                const elTag = originalNode.tagName.toLowerCase();
                // Check for <template slot="name"> or Vue-like <template #name> / <template v-slot:name>
                if (elTag === 'template' && (originalNode.hasAttribute('slot') || originalNode.getAttributeNames().some(attr => attr.startsWith('v-slot:') || attr.startsWith('#')))) {
                    isTemplateSlotSyntax = true;
                    const slotAttr = originalNode.getAttribute('slot') || originalNode.getAttributeNames().find(attr => attr.startsWith('v-slot:') || attr.startsWith('#'));
                    if (slotAttr) {
                        const nameMatch = slotAttr.match(/^(?:v-slot:|#)?([^=]+)/); // Extract name from v-slot:name or #name
                        slotName = (nameMatch && nameMatch[1] && nameMatch[1].trim() !== '') ? nameMatch[1].trim() : 'default';
                    }
                } else if (originalNode.hasAttribute('slot')) { // Standard <element slot="name">
                    slotName = originalNode.getAttribute('slot') || 'default';
                }
            }
            slotName = slotName.toLowerCase(); // Normalize slot name
            this._logDebug(`Slot '${slotName}' content:`, Array.from(isTemplateSlotSyntax ? originalNode.content.childNodes : [originalNode]).map(n => n.textContent));


            if (!capturedSlots[slotName]) capturedSlots[slotName] = []; // Ensure array exists for the slot name

            // Nodes to process are either children of <template> or the node itself
            const nodesToProcessForSlot = isTemplateSlotSyntax ? Array.from(originalNode.content.childNodes) : [originalNode];

            nodesToProcessForSlot.forEach(contentNode => {
                const clonedNodeForProcessing = contentNode.cloneNode(true); // Clone to avoid modifying original
                // Remove 'slot' attribute from the cloned node as it's now being processed for that slot
                if (clonedNodeForProcessing.nodeType === Node.ELEMENT_NODE) {
                    clonedNodeForProcessing.removeAttribute('slot');
                }

                // Process the slot content in the PARENT's context (data, component instance, loop scope)
                // The result will be appended to a temporary fragment first.
                const tempFragmentForProcessing = document.createDocumentFragment();
                const returnedNodeFromProcess = this._processNode(
                    clonedNodeForProcessing,
                    parentComponentInstance ? parentComponentInstance._templateContext : parentDataContext, // Parent's reactive context
                    parentComponentInstance, // Parent component instance
                    parentLoopScope,         // Parent's loop scope
                    tempFragmentForProcessing // Target fragment for processed nodes
                );

                // Append processed nodes from the fragment or the single returned node to the captured slot
                if (tempFragmentForProcessing.hasChildNodes()) {
                    Array.from(tempFragmentForProcessing.childNodes).forEach(finalNode => {
                        capturedSlots[slotName].push(finalNode);
                    });
                } else if (returnedNodeFromProcess && returnedNodeFromProcess.nodeType !== undefined) { // Check if it's a valid node
                    capturedSlots[slotName].push(returnedNodeFromProcess);
                }
            });
        });
        this._logDebug('Captured slots object:', Object.keys(capturedSlots).reduce((acc, key) => { acc[key] = capturedSlots[key].length + ' node(s)'; return acc; }, {}));
        return capturedSlots;
    }

    _compileComponentTemplate(componentInstance) {
        const componentDef = componentInstance._componentDef;
        const templateString = typeof componentDef.template === 'function'
            ? componentDef.template.call(componentInstance._templateContext) // Dynamic template function
            : componentDef.template;

        const tempDiv = document.createElement('div'); // Temporary container for parsing
        tempDiv.innerHTML = this.convertToSpandrixSyntax(templateString); // Convert Vue-like syntax if any
        const fragment = document.createDocumentFragment(); // Fragment to hold processed nodes

        // Process each top-level node from the template string in the component's own context
        Array.from(tempDiv.childNodes).forEach(node => {
            const processed = this._processNode(node.cloneNode(true), componentInstance._templateContext, componentInstance, {}, fragment);
            fragment.appendChild(processed);
        });

        // Slot processing: Find <slot> elements in the compiled template and replace them
        const slotElements = fragment.querySelectorAll('slot');
        slotElements.forEach(slotEl => {
            const slotName = (slotEl.getAttribute('name') || 'default').toLowerCase(); // Get slot name
            const assignedNodes = componentInstance.$slots[slotName] || []; // Get captured nodes for this slot

            if (assignedNodes.length > 0) {
                assignedNodes.forEach(n => {
                    // Clone the nodes from $slots as they are already processed with parent context
                    // and should be directly insertable. Cloning ensures they can be reused if slot is in a loop.
                    const clone = n.cloneNode(true);
                    slotEl.parentNode.insertBefore(clone, slotEl);
                });
            }
            // Remove the <slot> placeholder element itself
            slotEl.remove();
        });
        return fragment;
    }

    _updateComputedProperties(componentInstance, specificKey = null) {
        if (!componentInstance || !componentInstance._componentDef.computed || componentInstance._destroyed) return false;
        let changed = false;
        const contextToCall = componentInstance._templateContext; // 'this' context for computed functions

        const keysToUpdate = specificKey ? [specificKey] : Object.keys(componentInstance._componentDef.computed);

        for (const key of keysToUpdate) {
            if (!Object.prototype.hasOwnProperty.call(componentInstance._componentDef.computed, key)) continue;

            const computedWatcher = componentInstance._computedWatchers[key];
            if (computedWatcher && typeof computedWatcher.fn === 'function') {
                const oldVal = componentInstance._computedValuesCache[key];
                const newVal = computedWatcher.fn.call(contextToCall); // Calculate new value

                if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) { // Deep compare
                    componentInstance._computedValuesCache[key] = newVal; // Update cache
                    changed = true;
                    this._logDebug(`[Computed: ${key}] in <${componentInstance._componentDef._name}> (ID ${componentInstance._componentId}) updated to:`, newVal, '(was:', oldVal, ')');
                    // Trigger explicit $watchers for this computed property
                    componentInstance._watchers.forEach(w => {
                        if (w.path === key) { // If a $watch is on this computed prop
                            try { w.callback.call(contextToCall, newVal, oldVal); }
                            catch (e) { console.error(`Spandrix: $watch error for computed prop "${key}" in <${componentInstance._componentDef._name}>:`, e); }
                            w.oldValue = JSON.parse(JSON.stringify(newVal)); // Update watcher's old value
                        }
                    });
                    // Trigger component's 'watch' object for this computed property
                    if (componentInstance._componentDef.watch && typeof componentInstance._componentDef.watch[key] === 'function') {
                       try { componentInstance._componentDef.watch[key].call(contextToCall, newVal, oldVal); }
                       catch (e) { console.error(`Error in watcher for computed prop '${key}' in <${componentInstance._componentDef._name}>:`, e); }
                   }
                }
                computedWatcher.isFresh = true; // Mark as up-to-date for this cycle
            }
        }
        return changed; // Return true if any computed property changed
    }

    _destroyComponent(componentInstance) {
        if (!componentInstance || componentInstance._destroyed) return;
        const { _componentDef: compDef, _componentId: compId, _templateContext: contextToCall = componentInstance } = componentInstance;
        this._logDebug(`Destroying component <${compDef?._name || 'UnknownComponent'}> (ID: ${compId})`);

        // Lifecycle: BeforeDestroy
        this._callHook('beforeComponentDestroy', contextToCall, componentInstance);
        if (compDef?.beforeDestroy) try { compDef.beforeDestroy.call(contextToCall); } catch (e) { console.error(`Error in <${compDef?._name}> beforeDestroy():`, e); }

        // Cleanup: Remove .sync listeners, router listeners (if any were attached)
        if (componentInstance.$el?._spxSyncListeners) {
            componentInstance.$el._spxSyncListeners.forEach(l => componentInstance.$el.removeEventListener(l.event, l.handler));
            componentInstance.$el._spxSyncListeners = [];
        }
        // Router specific cleanup removed
        // if (componentInstance._routeChangeUnsubscribe) componentInstance._routeChangeUnsubscribe();
        // if (componentInstance._boundRouteUpdateHandler && this.router) this.router.off('routechanged', componentInstance._boundRouteUpdateHandler);

        // Cleanup: Remove all event listeners specifically bound by this component instance
        this._cleanupEventListenersBoundWithin(compId);

        componentInstance._destroyed = true; // Mark as destroyed
        // Cleanup: Clear component's DOM and internal properties
        if (componentInstance.$el) {
            // Remove Spandrix-specific properties from the host element
            ['_spxIfPlaceholderNode', '_spxIfOriginalTemplateNode', '_spxIfWatchersAttached',
             '_spandrixComponent', '_spxRepeatAnchor', '_spx_event_listeners',
             '_spx_data_model_handler', '_spx_data_model_event_type', '_spx_static_class',
             '_spxLastFetchId', '_spxLastFetchCompletedSuccessfully', '_spxProcessedSignature',
             '_spx_node_is_fetching_this_request_id'
            ].forEach(prop => delete componentInstance.$el[prop]);
            componentInstance.$el.removeAttribute('data-spx-id');
            componentInstance.$el.innerHTML = ''; // Clear content
        }
        // Nullify internal references to aid garbage collection
        ['_el', '$props', '_componentData', '_watchers', '_computedWatchers',
         '_computedValuesCache', '$refs', '$slots', '_templateContext',
         '_parentDataContext', '_parentComponentInstance', '_parentLoopScope'
        ].forEach(prop => componentInstance[prop] = null);

        // Lifecycle: Destroyed
        if (compDef?.destroyed) try { compDef.destroyed.call(contextToCall); } catch (e) { console.error(`Error in <${compDef?._name}> destroyed():`, e); }
        this._callHook('afterComponentDestroy', contextToCall, componentInstance);
        this._logDebug(`Component <${compDef?._name || 'UnknownComponent'}> (ID: ${compId}) destroyed.`);
    }

    _camelCase(str) { return String(str).replace(/[-_]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^(.)/, c => c.toLowerCase());}
    _pascalCase(str) { const camel = this._camelCase(str); return camel.charAt(0).toUpperCase() + camel.slice(1); }
    _kebabCase(str) { return String(str).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase(); }

    _updateComponentsUsingGlobalStateOrGlobalData() {
        this._logDebug('Checking components for updates due to global $state or globalData change.');
        // Iterate over all active Spandrix components in the DOM
        document.querySelectorAll('[data-spx-id]').forEach(el => {
            const compInstance = el._spandrixComponent;
            if (compInstance && !compInstance._destroyed && compInstance._mounted) {
                let usesGlobal = false;
                // Check if component template or computed properties reference $state or globalData
                const templateString = typeof compInstance._componentDef.template === 'function'
                    ? compInstance._componentDef.template.call(compInstance._templateContext)
                    : (compInstance._componentDef.template || '');
                if (templateString.includes('$state') || templateString.includes('globalData') ||
                    this._expressionUsesGlobal(templateString, compInstance._componentDef.computed, this.globalData, this.$state)) {
                    usesGlobal = true;
                }

                if (usesGlobal) {
                    this._logDebug(`Potentially updating component <${compInstance._componentDef._name}> (ID ${compInstance._componentId}) due to global change.`);
                    compInstance.$update(); // Trigger re-render
                }
            }
        });
        // Check if root template uses global state/data
        if (this.root && this._currentRootTemplateString &&
            (this._currentRootTemplateString.includes('$state') || this._currentRootTemplateString.includes('globalData') ||
             this._expressionUsesGlobal(this._currentRootTemplateString, null, this.globalData, this.$state))) {
            this._logDebug('Global change triggered root re-render via _reRenderRoot because root template uses globals.');
            this._reRenderRoot(this._currentRootTemplateString, this._currentRootData);
        }
    }

    _expressionUsesGlobal(template, computedProps, globalData, state) {
        // Simple string check, could be more sophisticated with AST parsing for accuracy
        const checkString = (str) => {
            if (str.includes('$state')) return true; // Direct reference to $state object
            if (str.includes('globalData')) return true; // Direct reference to globalData object
            // Check for direct usage of keys from globalData (e.g., {{ myGlobalVar }})
            for (const key in globalData) if (str.includes(key)) return true;
            // Note: Checking for keys within $state is harder without knowing $state's structure.
            // Relying on '$state.' prefix or direct '$state' usage is more common.
            return false;
        };
        if (checkString(template)) return true;
        if (computedProps) {
            for (const key in computedProps) {
                if (checkString(computedProps[key].toString())) return true; // Check computed function body
            }
        }
        return false;
    }


    _reRenderRoot(templateString, dataForRootProxy) {
        if (!this.root) { console.warn("Spandrix: Root element not set. Cannot re-render root."); return; }
        this._logDebug('Re-rendering root with template:', JSON.stringify(templateString), 'and data proxy:', dataForRootProxy );

        // Destroy all components currently under the root before re-rendering
        Array.from(this.root.querySelectorAll('[data-spx-id]')).forEach(el => {
            if (el._spandrixComponent) this._destroyComponent(el._spandrixComponent);
        });

        const processedRootTemplateString = this.convertToSpandrixSyntax(templateString);
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = processedRootTemplateString;

        const fragmentToAppend = document.createDocumentFragment();
        Array.from(tempContainer.childNodes).forEach(childNode => {
            const clonedChild = childNode.cloneNode(true);
            // Clear any previous processing signature from the cloned template nodes
            delete clonedChild._spxProcessedSignature;
            if (clonedChild.querySelectorAll) { // Also clear for descendants
                clonedChild.querySelectorAll('*').forEach(desc => delete desc._spxProcessedSignature);
            }
            const processedChild = this._processNode(clonedChild, dataForRootProxy, null, {}, fragmentToAppend);
            fragmentToAppend.appendChild(processedChild);
        });

        this.root.innerHTML = ''; // Clear existing root content
        this.root.appendChild(fragmentToAppend);
        this._logDebug('Root re-render complete.');
    }

    applyData(userData, templateString = null) {
        if (!this.root) { console.warn("Spandrix: Root element not set. Cannot applyData."); return; }

        const newRootData = (typeof userData === 'object' && userData !== null) ? userData : {};
        this._logDebug('Applying data to root. User data:', { ...newRootData }); // Log a copy

        // Create new reactive root data object.
        // The callback will trigger _reRenderRoot on changes.
        this._currentRootData = this._makeReactive(newRootData, this._rootDataUpdateCallback, `_currentRootData_userProvided`);
        this._currentRootDataTarget = newRootData; // Keep a reference to the original target for debugging or direct comparison if needed

        // Determine the template string: user-provided, current root HTML, or original root template
        this._currentRootTemplateString = templateString || this.root.innerHTML || this._originalRootTemplate;
        if (!this._currentRootTemplateString && this.root) this._currentRootTemplateString = this._originalRootTemplate; // Fallback

        this._reRenderRoot(this._currentRootTemplateString, this._currentRootData);
    }


    // initRouter method removed

    setState(newStateOrPath, value) {
        if (typeof newStateOrPath === 'string') { // Path-based update: setState('user.name', 'Alice')
            this._setValueByPath(this.$state, newStateOrPath, value);
        } else if (typeof newStateOrPath === 'object' && newStateOrPath !== null) { // Object-based update: setState({ counter: 1, user: ... })
            for (const key in newStateOrPath) this.$state[key] = newStateOrPath[key]; // Assigns reactively
        } else console.error('Spandrix: setState expects an object or a path-value pair.');
        this._logDebug('Global state updated via setState. New $state:', this.$state);
    }

    watchState(path, callback) {
        if (typeof callback !== 'function' || typeof path !== 'string' || path.trim() === '') {
            console.error('Spandrix: watchState requires a non-empty path string and a callback function.');
            return () => {}; // Return a no-op unwatch function
        }
        const initialValue = this._getValueByPath(this.$state, path);
        const watcher = { path, callback, lastValue: JSON.parse(JSON.stringify(initialValue)) }; // Store initial value for comparison
        this._stateWatchers.push(watcher);
        this._logDebug(`Watching global state path: "${path}"`);
        return () => { // Unwatch function
            this._stateWatchers = this._stateWatchers.filter(w => w !== watcher);
            this._logDebug(`Stopped watching global state path: "${path}"`);
        };
    }

    _addWatcher(componentInstance, path, callback) {
        if (!componentInstance || typeof callback !== 'function' || typeof path !== 'string' || path.trim() === '') {
            console.error('Spandrix $watch: Invalid arguments. Requires component instance, non-empty path string, and callback function.');
            return () => {}; // Return no-op unwatch function
        }
        // Function to resolve the value being watched, considering different contexts ($state, globalData, component context)
        const resolveWatchedValue = () => {
            const context = componentInstance._templateContext; // Component's reactive context
            if (path.startsWith('$state.')) return this._getValueByPath(this.$state, path.substring('$state.'.length));
            if (path.startsWith('globalData.')) return this._getValueByPath(this.globalData, path.substring('globalData.'.length));
            return this._getValueByPath(context, path); // Default to component's context
        };

        const initialValue = resolveWatchedValue();
        const watcherRec = { path, callback, oldValue: JSON.parse(JSON.stringify(initialValue)) }; // Store initial value
        componentInstance._watchers.push(watcherRec);
        this._logDebug(`$watch: Added watcher for path "${path}" on component <${componentInstance._componentDef._name}> (ID ${componentInstance._componentId})`);
        return () => { // Unwatch function
            if (componentInstance._watchers) { // Ensure watchers array still exists (component might be destroyed)
                componentInstance._watchers = componentInstance._watchers.filter(w => w !== watcherRec);
                this._logDebug(`$watch: Removed watcher for path "${path}" on component <${componentInstance._componentDef._name}>`);
            }
        };
    }

    use(plugin, options = {}) {
        if (plugin && typeof plugin.install === 'function') { // Plugin object with install method
            try { plugin.install(this, options); this.plugins.push(plugin); this._logDebug('Plugin installed:', plugin.name || 'anonymous plugin object'); }
            catch (e) { console.error('Spandrix: Error installing plugin object:', e); }
        } else if (typeof plugin === 'function') { // Plugin as a function
             try { plugin(this, options); this.plugins.push(plugin); this._logDebug('Functional plugin executed:', plugin.name || 'anonymous plugin function'); }
             catch (e) { console.error('Spandrix: Error executing functional plugin:', e); }
        } else console.error('Spandrix: Invalid plugin. Must be an object with an install method or a function.');
        return this; // Allow chaining
    }

    addHook(hookName, hookFn) {
        if (this._hooks[hookName] && typeof hookFn === 'function') {
            this._hooks[hookName].push(hookFn); this._logDebug(`Added hook to '${hookName}'`);
        } else console.warn(`Spandrix: Cannot add hook. Unknown hook name '${hookName}' or invalid function.`);
    }

    _getCSRFToken() { /* Placeholder for CSRF token logic if needed by request */ return null;}

    async request(url, options = {}) {
        this._logDebug('Request:', options.method || 'GET', url, options);
        let finalOptions = { ...options }; // Clone options to allow modification by interceptors

        // Apply request interceptors
        for (const interceptor of this._requestInterceptors) {
            finalOptions = await interceptor(finalOptions, url) || finalOptions; // Interceptor can modify options
        }

        try {
            const response = await fetch(url, finalOptions);
            let data = response; // Initially, data is the Response object

            // Apply response success interceptors
            for (const interceptor of this._responseInterceptors) {
                if (interceptor.success) data = await interceptor.success(data, url, finalOptions) || data;
            }

            // Standard response handling after interceptors
            if (!response.ok) { // Check response.ok after interceptors had a chance to modify 'data'
                const errorText = await (data.text ? data.text() : response.text()); // Use data.text if interceptor returned a new response-like obj
                throw new Error(`HTTP error ${response.status}: ${errorText}`);
            }
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) return (data.json ? data.json() : response.json());
            return (data.text ? data.text() : response.text());
        } catch (error) {
            let mutableError = error;
            // Apply response error interceptors
            for (const interceptor of this._responseInterceptors) {
                if (interceptor.error) mutableError = await interceptor.error(mutableError, url, finalOptions) || mutableError;
            }
            console.error('Spandrix request error:', mutableError);
            throw mutableError; // Re-throw (possibly modified) error
        }
    }
    async loadJSON(url, options = {}) { return this.request(url, { method: 'GET', ...options, headers: {...(options.headers || {}), 'Accept': 'application/json'} }); }
    async renderFrom(url, options = {}) {
        if (!this.root) { console.warn("Spandrix: Root element not set. Cannot renderFrom URL."); return Promise.reject(new Error("Root element not set")); }
        return this.loadJSON(url, options)
            .then(data => { this.applyData(data); return data; }) // Apply fetched data to root
            .catch(err => { console.error(`Spandrix: Failed to render from URL "${url}".`, err); if (this.root) this.root.innerHTML = `<p style="color:red;">Error loading data from ${url}. Check console.</p>`; throw err; });
    }
    addRequestInterceptor(fn) { if (typeof fn === 'function') this._requestInterceptors.push(fn); }
    addResponseInterceptor(successFn, errorFn = null) { if (typeof successFn === 'function' || typeof errorFn === 'function') this._responseInterceptors.push({ success: successFn, error: errorFn });}
    clearFetchCache(keyPrefix = null) { // Basic cache clearing
        if (keyPrefix) {
            for (const key of this._fetchCache.keys()) {
                if (key.startsWith(keyPrefix)) this._fetchCache.delete(key);
            }
        } else this._fetchCache.clear();
        this._logDebug('Fetch cache cleared' + (keyPrefix ? ` for prefix "${keyPrefix}"` : '.'));
    }

    _processFetchDirective(node, dataContext, componentInstance, loopScope = {}) {
        const fetchUrlRaw = node.getAttribute('data-fetch'); if (!fetchUrlRaw) return;
        // Interpolate URL using the appropriate context
        const contextForInterpolation = componentInstance ? componentInstance._templateContext : dataContext;
        const fetchUrl = this._interpolateString(fetchUrlRaw, contextForInterpolation, componentInstance, loopScope);

        const fetchAs = node.getAttribute('data-fetch-as') || 'fetchedData'; // Key to store data under
        const fetchMethod = (node.getAttribute('data-fetch-method') || 'GET').toUpperCase();
        const fetchLoadingClass = node.getAttribute('data-fetch-loading-class'); // Optional class for loading state
        const fetchErrorClass = node.getAttribute('data-fetch-error-class');   // Optional class for error state

        const cacheAttr = node.getAttribute('data-fetch-cache'); // e.g., "false" or "true" (default)
        const explicitNoCache = (cacheAttr === 'false'); // Disable caching if 'false'

        let targetContextObject, effectiveFetchAsKey = fetchAs;
        const contextNameForFetchStateContainer = componentInstance ? `<${componentInstance._componentDef._name}>._componentData` : '_currentRootData';

        // Determine where to store the fetched data and its state ($loading, $error)
        if (fetchAs.startsWith('$state.')) {
            targetContextObject = this.$state; effectiveFetchAsKey = fetchAs.substring('$state.'.length);
        } else if (fetchAs.startsWith('globalData.')) {
            targetContextObject = this.globalData; effectiveFetchAsKey = fetchAs.substring('globalData.'.length);
        } else if (componentInstance) {
            targetContextObject = componentInstance._componentData; // Store in component's data
        } else {
            targetContextObject = dataContext; // Store in root data context
        }

        // Ensure the target property for fetch state is a reactive object
        let fetchStateContainer = this._getValueByPath(targetContextObject, effectiveFetchAsKey);
        if (!fetchStateContainer || typeof fetchStateContainer !== 'object' || !fetchStateContainer._isReactiveProxy) {
            const newContainer = this._makeReactive(
                { $loading: false, $error: null, data: null, _spxLastFetchId: null, _spxLastFetchCompletedSuccessfully: false, _spxIsCurrentlyFetching: false },
                (changedObject, changedKey, newValue, oldValue) => { // Callback for reactive changes within fetchStateContainer
                    this._logDebug(`data-fetch: Reactive change in fetch state for '${effectiveFetchAsKey}.${String(changedKey)}': ${oldValue} -> ${newValue}`);
                    // If state changes, trigger update on component or root
                    if (componentInstance && componentInstance._mounted) {
                        componentInstance.$update();
                    } else if (targetContextObject === this._currentRootData || dataContext === this._currentRootData) {
                        this._logDebug(`data-fetch: Reactive change in root data's fetch state for '${effectiveFetchAsKey}'. Triggering root re-render.`);
                        Promise.resolve().then(() => {
                            this._reRenderRoot(this._currentRootTemplateString, this._currentRootData);
                        }).catch(error => console.error("Spandrix: Error in promise for root re-render from data-fetch state change:", error));
                    }
                },
                `${contextNameForFetchStateContainer}.${effectiveFetchAsKey}` // Context name for debugging
            );
            this._setValueByPath(targetContextObject, effectiveFetchAsKey, newContainer);
            fetchStateContainer = newContainer;
        } else if (fetchStateContainer._spxIsCurrentlyFetching === undefined) { // Ensure flag exists if container was pre-existing
            fetchStateContainer._spxIsCurrentlyFetching = false;
        }


        const fetchRequestId = JSON.stringify({url: fetchUrl, method: fetchMethod}); // Unique ID for this request configuration

        // Guard 1: Data already successfully fetched for this ID and caching is allowed.
        if (fetchStateContainer._spxLastFetchId === fetchRequestId &&
            fetchStateContainer._spxLastFetchCompletedSuccessfully &&
            !explicitNoCache) {
            this._logDebug('data-fetch: Using existing successfully fetched data for', fetchUrl);
            if (fetchStateContainer.$loading) fetchStateContainer.$loading = false; // Ensure loading is false if somehow stuck
            if (node._spx_node_is_fetching_this_request_id === fetchRequestId) delete node._spx_node_is_fetching_this_request_id; // Clear node-specific flag if set
            return; // Do not re-fetch
        }

        // Guard 2: Fetch is already in progress for this specific request (via node flag)
        // OR for this state container for this specific request ID (via state container flags).
        // The node-specific flag acts as an immediate semaphore for the current processing pass of this node.
        // The state container flag prevents multiple fetches if different nodes point to the same state container.
        if (node._spx_node_is_fetching_this_request_id === fetchRequestId ||
            (fetchStateContainer._spxIsCurrentlyFetching === true && fetchStateContainer._spxLastFetchId === fetchRequestId) ) {
            this._logDebug(`data-fetch: Fetch already in progress for ('${effectiveFetchAsKey}', ${fetchUrl}, node flag: ${node._spx_node_is_fetching_this_request_id === fetchRequestId}, state flag: ${fetchStateContainer._spxIsCurrentlyFetching}). Skipping.`);
            if (!fetchStateContainer.$loading) fetchStateContainer.$loading = true; // Ensure UI reflects loading if it was reset
            if (fetchLoadingClass && node.classList && !node.classList.contains(fetchLoadingClass)) node.classList.add(fetchLoadingClass);
            return; // Do not re-fetch
        }


        this._logDebug(`data-fetch: Initiating fetch for ${fetchUrl} into ${effectiveFetchAsKey}`);
        node._spx_node_is_fetching_this_request_id = fetchRequestId; // Set node-specific semaphore
        fetchStateContainer._spxIsCurrentlyFetching = true;     // Set state container semaphore
        fetchStateContainer._spxLastFetchId = fetchRequestId;   // Store ID of current fetch attempt
        fetchStateContainer._spxLastFetchCompletedSuccessfully = false; // Reset success flag
        fetchStateContainer.$loading = true; // Set loading state (triggers reactivity)
        fetchStateContainer.$error = null;   // Clear previous errors

        // Apply loading class if specified
        if (fetchLoadingClass && node.classList) node.classList.add(fetchLoadingClass);
        if (fetchErrorClass && node.classList) node.classList.remove(fetchErrorClass); // Remove error class

        this.request(fetchUrl, { method: fetchMethod })
            .then(data => {
                fetchStateContainer.data = data; // Store fetched data
                fetchStateContainer.$error = null;
                fetchStateContainer._spxLastFetchCompletedSuccessfully = true; // Mark as successful
            })
            .catch(error => {
                console.error(`Spandrix: data-fetch to "${fetchUrl}" failed:`, error);
                fetchStateContainer.data = null; // Clear data on error
                fetchStateContainer.$error = error.message || String(error); // Store error message
                // _spxLastFetchCompletedSuccessfully remains false
                if (fetchErrorClass && node.classList) node.classList.add(fetchErrorClass); // Apply error class
            })
            .finally(() => {
                // Clear node-specific semaphore if it was set by this instance of processing
                if (node._spx_node_is_fetching_this_request_id === fetchRequestId) {
                    delete node._spx_node_is_fetching_this_request_id;
                }
                // Clear state container's fetching flag ONLY if this is the fetch that matches its ID
                // (prevents a fast subsequent fetch request from prematurely clearing the flag of a slow current one)
                if (fetchStateContainer._spxLastFetchId === fetchRequestId) {
                    fetchStateContainer._spxIsCurrentlyFetching = false;
                }
                fetchStateContainer.$loading = false; // Clear loading state (triggers reactivity)
                if (fetchLoadingClass && node.classList) node.classList.remove(fetchLoadingClass); // Remove loading class
            });
    }

    _registerSystemComponents() {
        // Router-specific components (router-view, link-to) removed.

        // Example basic UI components (can be expanded or moved to plugins)
        this.registerComponent('x-button', {
            template: `<button class="x-button" :type="type" :disabled="disabled" @click="handleClick"><slot></slot></button>`,
            props: { type: { default: 'button' }, disabled: { type: Boolean, default: false } },
            methods: { handleClick(event) { if (!this.disabled) this.$emit('click', event); } }
        });

        this.registerComponent('x-modal', {
            template: `
                <div class="x-modal-overlay" data-if="isOpen" @click.self="handleOverlayClick">
                    <div class="x-modal-content">
                        <header class="x-modal-header" data-if="!hideHeader">
                            <slot name="header"><h2>{{ title }}</h2></slot>
                            <button class="x-modal-close" @click="close" data-if="showCloseButton">&times;</button>
                        </header>
                        <section class="x-modal-body"><slot></slot></section>
                        <footer class="x-modal-footer" data-if="!hideFooter"><slot name="footer"></slot></footer>
                    </div>
                </div>`,
            props: {
                isOpen: { type: Boolean, default: false },
                title: { default: 'Modal Title' },
                showCloseButton: { type: Boolean, default: true },
                closeOnClickOverlay: { type: Boolean, default: true },
                hideHeader: { type: Boolean, default: false },
                hideFooter: { type: Boolean, default: false },
            },
            model: { prop: 'isOpen', event: 'update:isOpen' }, // For two-way binding on isOpen
            methods: {
                close() { this.$emit('update:isOpen', false); this.$emit('close'); },
                handleOverlayClick() { if (this.closeOnClickOverlay) this.close(); }
            },
            watch: { isOpen(newVal) { if (newVal) this.$emit('open'); } } // Emit open event
        });

        this.registerComponent('x-input', {
            template: `<input class="x-input" :type="type" :value="modelValue" :placeholder="placeholder" :disabled="disabled" :readonly="readonly" @input="handleInput" @change="handleChange" @blur="handleBlur" @focus="handleFocus" />`,
            props: {
                modelValue: { default: '' }, // For v-model like binding
                type: { default: 'text' },
                placeholder: { default: '' },
                disabled: { type: Boolean, default: false },
                readonly: { type: Boolean, default: false }
            },
            model: { prop: 'modelValue', event: 'update:modelValue' }, // Defines v-model behavior
            methods: {
                handleInput(event) { this.$emit('update:modelValue', event.target.value); this.$emit('input', event); },
                handleChange(event) { this.$emit('change', event); },
                handleBlur(event) { this.$emit('blur', event); },
                handleFocus(event) { this.$emit('focus', event); }
            }
        });
    }
}

try {
    if (typeof exportFunction !== 'undefined') { // For specific environments like Google's Wirth
         exportFunction({ SpandrixEngine });
    } else if (typeof exports === 'object' && typeof module !== 'undefined') { // CommonJS (Node)
        module.exports = { SpandrixEngine };
    } else if (typeof define === 'function' && define.amd) { // AMD
        define('Spandrix', [], () => ({ SpandrixEngine }));
    } else { // Browser global
        window.SpandrixEngine = SpandrixEngine;
        // window.SpandrixRouter = SpandrixRouter; // Router removed
    }
} catch (e) {
    // Fallback or error logging if needed, e.g. if none of the export mechanisms are available
    console.error("Spandrix Engine: Could not determine export environment.", e);
    // Attempt to set to window as a last resort if 'window' exists
    if (typeof window !== 'undefined') {
        window.SpandrixEngine = SpandrixEngine;
    }
}

export { SpandrixEngine };