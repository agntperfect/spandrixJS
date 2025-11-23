/**
 * @class SpandrixEngine
 * @version 2.0.0
 * @description A modular, reactive DOM engine
 * @author AgentPerfect
 * @license MIT
 */
class SpandrixEngine {
    constructor(rootSelector, userOptions = {}) {
        this.root = document.querySelector(rootSelector);
        if (!this.root) {
            throw new Error(`Spandrix: Root element with selector "${rootSelector}" not found.`);
        }
        
        this._originalRootTemplate = this.root ? this.root.innerHTML : '';
        this.options = Object.assign({
            missingValuePlaceholder: '',
            debug: false,
            componentIdPrefix: 'spx-c-',
            strictExpressions: false,
            warnOnUnsafeEval: true,
            allowRawHTML: false,
            csrfCookieName: 'XSRF-TOKEN',
            csrfHeaderName: 'X-XSRF-TOKEN',
            enablePerformanceMetrics: false,
            maxRecursionDepth: 50
        }, userOptions || {});

        this.components = {};
        this.filters = {};
        this._eventListeners = [];
        this._performanceMetrics = { renders: 0, updates: 0, avgRenderTime: 0 };

        this._rootDataUpdateCallback = (target, key, value, oldValue) => {
            this._logDebug(`Root data reactive change on key '${String(key)}':`, oldValue, '->', value);
            this._scheduleRootReRender();
        };

        this._currentRootDataTarget = {};
        this._currentRootData = this._makeReactive(
            this._currentRootDataTarget,
            this._rootDataUpdateCallback,
            '_currentRootData_initial'
        );
        this._currentRootTemplateString = null;
        this._rootRerenderScheduled = false;
        this.globalData = this._makeReactive({}, () => {
            this._logDebug('GlobalData changed, updating affected components and root.');
            this._updateComponentsUsingGlobalStateOrGlobalData();
        }, 'globalData');

        this._componentCounter = 0;
        this.$state = this._makeReactive({}, (target, key, value, oldValue) => {
            this._logDebug(`Global $state changed: ${String(key)}`, oldValue, '->', value);
            this._stateWatchers.forEach(w => {
                if (this._pathMatches(w.path, key)) {
                    const currentVal = this._getValueByPath(this.$state, w.path);
                    if (JSON.stringify(currentVal) !== JSON.stringify(w.lastValue)) {
                        try {
                            w.callback.call(this.$state, currentVal, w.lastValue);
                        } catch (e) {
                            console.error('Global state watcher error:', e);
                        }
                        w.lastValue = this._deepClone(currentVal);
                    }
                }
            });
            this._updateComponentsUsingGlobalStateOrGlobalData();
        }, '$state');
        this._stateWatchers = [];

        this.plugins = [];
        this._hooks = {
            beforeComponentCreate: [],
            afterComponentCreate: [],
            beforeComponentMount: [],
            afterComponentMount: [],
            beforeComponentUpdate: [],
            afterComponentUpdate: [],
            beforeComponentDestroy: [],
            afterComponentDestroy: [],
            beforeRootRender: [],
            afterRootRender: []
        };

        this._requestInterceptors = [];
        this._responseInterceptors = [];
        this._fetchCache = new Map();
        this._directives = new Map();
        this._recursionDepth = 0;

        this._registerSystemComponents();
        this._registerCoreDirectives();
        this._registerCoreFilters();
    }

    _logDebug(...args) {
        if (this.options.debug) console.debug('[Spandrix]', ...args);
    }

    _logPerformance(label, fn) {
        if (!this.options.enablePerformanceMetrics) return fn();
        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;
        this._logDebug(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
        return result;
    }

    enableDebug() {
        this.options.debug = true;
        this._logDebug('Debug mode enabled.');
    }

    disableDebug() {
        this.options.debug = false;
    }

    config(newOptions = {}) {
        if (this._configLocked) {
            console.warn('Spandrix: Config is locked.');
            return;
        }
        Object.assign(this.options, newOptions);
        this._logDebug('Configuration updated:', this.options);
    }

    lockConfig() {
        this._configLocked = true;
        this._logDebug('Configuration locked.');
    }

    _generateComponentId() {
        return `${this.options.componentIdPrefix}${this._componentCounter++}`;
    }

    _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (obj instanceof RegExp) return new RegExp(obj);
        if (Array.isArray(obj)) return obj.map(item => this._deepClone(item));
        
        const cloned = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = this._deepClone(obj[key]);
            }
        }
        return cloned;
    }

    _pathMatches(watchPath, changedKey) {
        return watchPath === changedKey ||
               watchPath.startsWith(changedKey + '.') ||
               String(changedKey).startsWith(watchPath + '.');
    }

    _makeReactive(obj, updateCallback, contextName = 'object') {
        const engine = this;
        if (obj && obj._isReactiveProxy) return obj;
        if (typeof obj !== 'object' || obj === null) return obj;

        const handler = {
            get(target, key, receiver) {
                if (key === '_isReactiveProxy') return true;
                if (key === '_reactiveTarget') return target;
                
                const value = Reflect.get(target, key, receiver);

                if (typeof value === 'object' && value !== null &&
                    !value._isReactiveProxy &&
                    !Object.isFrozen(value) &&
                    !(value instanceof Node) &&
                    !(value instanceof Date) &&
                    !(value instanceof RegExp) &&
                    (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
                    
                    if (target[key] === value) {
                        target[key] = engine._makeReactive(
                            value,
                            () => updateCallback(target, String(key), target[key], value),
                            `${contextName}.${String(key)}`
                        );
                    }
                }
                return target[key];
            },

            set(target, key, value, receiver) {
                const oldValue = target[key];

                if (value === oldValue && (typeof value !== 'object' || value === null)) {
                    return true;
                }

                const result = Reflect.set(target, key, value, receiver);
                
                if (result && !String(key).startsWith('_')) {
                    const hasChanged = JSON.stringify(oldValue) !== JSON.stringify(value);
                    if (hasChanged) {
                        engine._logDebug(`Reactive set in ${contextName}: ${String(key)}`, oldValue, '->', value);
                        if (updateCallback) {
                            updateCallback(target, String(key), value, oldValue);
                        }
                    }
                }
                return result;
            },

            deleteProperty(target, key) {
                const oldValue = target[key];
                const result = Reflect.deleteProperty(target, key);
                
                if (result && !String(key).startsWith('_')) {
                    engine._logDebug(`Reactive delete in ${contextName}: ${String(key)}`);
                    if (updateCallback) {
                        updateCallback(target, String(key), undefined, oldValue);
                    }
                }
                return result;
            }
        };

        return new Proxy(obj, handler);
    }

    setGlobalData(globalObj) {
        if (typeof globalObj !== 'object' || globalObj === null) {
            console.warn('Spandrix: setGlobalData expects a non-null object.');
            return;
        }
        
        for (const key in this.globalData) {
            if (!(key in globalObj)) delete this.globalData[key];
        }
        for (const key in globalObj) {
            this.globalData[key] = globalObj[key];
        }
        this._logDebug('Global data updated:', this.globalData);
    }

    setState(newStateOrPath, value) {
        if (typeof newStateOrPath === 'string') {
            this._setValueByPath(this.$state, newStateOrPath, value);
        } else if (typeof newStateOrPath === 'object' && newStateOrPath !== null) {
            for (const key in newStateOrPath) {
                this.$state[key] = newStateOrPath[key];
            }
        } else {
            console.error('Spandrix: setState expects an object or a path-value pair.');
        }
        this._logDebug('Global state updated:', this.$state);
    }

    watchState(path, callback) {
        if (typeof callback !== 'function' || typeof path !== 'string' || !path.trim()) {
            console.error('Spandrix: watchState requires a path string and callback function.');
            return () => {};
        }
        
        const initialValue = this._getValueByPath(this.$state, path);
        const watcher = {
            path,
            callback,
            lastValue: this._deepClone(initialValue)
        };
        
        this._stateWatchers.push(watcher);
        this._logDebug(`Watching global state path: "${path}"`);
        
        return () => {
            this._stateWatchers = this._stateWatchers.filter(w => w !== watcher);
            this._logDebug(`Stopped watching global state path: "${path}"`);
        };
    }

    _getValueByPath(obj, path) {
        if (path === '.' || !path) return obj;
        if (typeof path !== 'string') return undefined;
        
        return path.split('.').reduce((acc, key) => {
            return (acc && typeof acc === 'object' && key in acc) ? acc[key] : undefined;
        }, obj);
    }

    _setValueByPath(obj, path, value) {
        if (typeof path !== 'string' || !path.trim()) {
            this._logDebug('_setValueByPath: Invalid path.', path);
            return false;
        }
        
        const keys = path.split('.');
        const lastKey = keys.pop();
        let current = obj;
        
        for (const key of keys) {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[lastKey] = value;
        return true;
    }

    _sanitizeHTML(input) {
        if (typeof input !== 'string') return String(input ?? '');
        const temp = document.createElement('div');
        temp.textContent = input;
        return temp.innerHTML;
    }

    _isValidExpression(expression) {
        const dangerousPatterns = [
            /Function\s*\(/i,
            /eval\s*\(/i,
            /setTimeout\s*\(/i,
            /setInterval\s*\(/i,
            /__proto__/i,
            /constructor\s*\[/i
        ];
        
        return !dangerousPatterns.some(pattern => pattern.test(expression));
    }

    registerComponent(name, definition) {
        if (!name || !definition || !definition.template) {
            console.error("Spandrix: Invalid component definition for", name);
            return;
        }
        
        const lowerCaseName = name.toLowerCase();
        const propsDef = {};
        
        if (definition.props) {
            if (Array.isArray(definition.props)) {
                definition.props.forEach(pName => {
                    propsDef[this._camelCase(pName)] = { type: null };
                });
            } else {
                for (const pName in definition.props) {
                    const normalizedPName = this._camelCase(pName);
                    const propValue = definition.props[pName];
                    
                    propsDef[normalizedPName] = (typeof propValue === 'object' && 
                        propValue !== null && 
                        ('type' in propValue || 'default' in propValue))
                        ? propValue
                        : { type: propValue };
                }
            }
        }
        
        this.components[lowerCaseName] = {
            ...definition,
            _name: lowerCaseName,
            _propsDef: propsDef
        };
        
        this._logDebug(`Registered component: <${lowerCaseName}>`);
    }

    registerFilter(name, filterFn) {
        if (typeof filterFn !== 'function') {
            console.error(`Spandrix: Filter "${name}" must be a function.`);
            return;
        }
        this.filters[name] = filterFn;
        this._logDebug(`Registered filter: "${name}"`);
    }

    _registerCoreFilters() {
        this.registerFilter('uppercase', val => String(val || '').toUpperCase());
        this.registerFilter('lowercase', val => String(val || '').toLowerCase());
        this.registerFilter('capitalize', val => {
            const str = String(val || '');
            return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
        });
        this.registerFilter('truncate', (val, length = 50, suffix = '...') => {
            const str = String(val || '');
            return str.length > length ? str.substring(0, length) + suffix : str;
        });
        this.registerFilter('currency', (val, symbol = '$', decimals = 2) => {
            const num = parseFloat(val) || 0;
            return symbol + num.toFixed(decimals);
        });
        this.registerFilter('date', (val, format = 'short') => {
            const date = val instanceof Date ? val : new Date(val);
            if (isNaN(date.getTime())) return String(val || '');
            
            const options = {
                short: { year: 'numeric', month: 'short', day: 'numeric' },
                long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
                time: { hour: '2-digit', minute: '2-digit' }
            };
            
            return date.toLocaleDateString('en-US', options[format] || options.short);
        });
        this.registerFilter('json', (val, indent = 2) => {
            try {
                return JSON.stringify(val, null, indent);
            } catch (e) {
                return String(val || '');
            }
        });
        this.registerFilter('default', (val, defaultValue = '') => {
            return (val === undefined || val === null || val === '') ? defaultValue : val;
        });
    }

    _parseFilterCall(filterCallStr, evaluationContext) {
        const parts = filterCallStr.split(':').map(s => s.trim());
        const name = parts[0];
        const args = parts.slice(1).map(argStr => {
            if ((argStr.startsWith("'") && argStr.endsWith("'")) ||
                (argStr.startsWith('"') && argStr.endsWith('"'))) {
                return argStr.slice(1, -1);
            }
            
            const num = parseFloat(argStr);
            if (!isNaN(num) && isFinite(argStr)) return num;
            
            if (argStr === 'true') return true;
            if (argStr === 'false') return false;
            
            if (argStr === 'null') return null;
            if (argStr === 'undefined') return undefined;
            
            if (argStr === '$state') return this.$state;
            if (argStr.startsWith('$state.')) {
                return this._getValueByPath(this.$state, argStr.substring(7));
            }
            
            const valFromCtx = this._getValueByPath(evaluationContext, argStr);
            if (valFromCtx !== undefined) return valFromCtx;
            
            if (this.globalData && argStr in this.globalData) {
                return this.globalData[argStr];
            }
            
            return undefined;
        });
        
        return { name, args };
    }

    _buildScopedEvaluator(expression, baseDataContext, componentInstance, additionalScope = {}) {
        if (!expression || typeof expression !== 'string' || !expression.trim()) {
            return () => undefined;
        }

        if (!this._isValidExpression(expression)) {
            console.warn(`Spandrix: Blocked unsafe expression: "${expression}"`);
            return () => undefined;
        }

        const engine = this;
        const contextKeyNames = new Set();
        const contextValueProviders = new Map();

        const addKeyFromProvider = (keyName, valueProvider) => {
            if (!contextKeyNames.has(keyName) && /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(keyName)) {
                contextKeyNames.add(keyName);
                contextValueProviders.set(keyName, valueProvider);
            }
        };

        if (additionalScope) {
            for (const key in additionalScope) {
                if (Object.prototype.hasOwnProperty.call(additionalScope, key)) {
                    addKeyFromProvider(key, () => additionalScope[key]);
                }
            }
        }

        if (componentInstance && componentInstance._templateContext) {
            const compCtx = componentInstance._templateContext;
            const compDef = componentInstance._componentDef;
            
            if (compDef) {
                if (compDef._propsDef) {
                    Object.keys(compDef._propsDef).forEach(p => 
                        addKeyFromProvider(p, () => compCtx[p])
                    );
                }
                if (componentInstance._componentData) {
                    Object.keys(componentInstance._componentData).forEach(d =>
                        addKeyFromProvider(d, () => compCtx[d])
                    );
                }
                if (compDef.computed) {
                    Object.keys(compDef.computed).forEach(c =>
                        addKeyFromProvider(c, () => compCtx[c])
                    );
                }
                if (compDef.methods) {
                    Object.keys(compDef.methods).forEach(m =>
                        addKeyFromProvider(m, () => compCtx[m])
                    );
                }
            }
        }

        if (baseDataContext) {
            for (const key in baseDataContext) {
                if (key !== '_isReactiveProxy' && 
                    Object.prototype.hasOwnProperty.call(baseDataContext, key)) {
                    addKeyFromProvider(key, () => baseDataContext[key]);
                }
            }
        }

        if (engine.globalData) {
            for (const key in engine.globalData) {
                if (Object.prototype.hasOwnProperty.call(engine.globalData, key)) {
                    addKeyFromProvider(key, () => engine.globalData[key]);
                }
            }
        }

        addKeyFromProvider('$state', () => engine.$state);
        addKeyFromProvider('globalData', () => engine.globalData);

        const finalKeys = Array.from(contextKeyNames);
        const debugCtx = componentInstance 
            ? `<${componentInstance._componentDef._name}>` 
            : 'Root';
        
        engine._logDebug(`Evaluator for "${expression}" in ${debugCtx} with keys:`, finalKeys);

        try {
            const fn = new Function(...finalKeys, `return (${expression});`);
            
            return () => {
                try {
                    const values = finalKeys.map(k => contextValueProviders.get(k)?.());
                    return fn(...values);
                } catch (e) {
                    if (engine.options.strictExpressions) throw e;
                    engine._logDebug(`Eval error in "${expression}":`, e.message);
                    return undefined;
                }
            };
        } catch (e) {
            console.error(`Spandrix: Compile error in "${expression}":`, e.message);
            return () => undefined;
        }
    }

    _interpolateString(templateStr, dataContext, componentInstance = null, loopScope = {}) {
        if (typeof templateStr !== 'string') return String(templateStr ?? '');
        
        return templateStr.replace(/{{{([\s\S]*?)}}}|{{([\s\S]*?)}}/g, (_match, rawExpr, escapedExpr) => {
            const isRaw = !!rawExpr;
            let expressionAndFilters = (isRaw ? rawExpr : escapedExpr).trim();
            const parts = expressionAndFilters.split('|').map(s => s.trim());
            const expression = parts[0];
            const filterCalls = parts.slice(1);
            
            let value = this._buildScopedEvaluator(expression, dataContext, componentInstance, loopScope)();
            
            const filterArgEvalContext = {
                ...(componentInstance ? componentInstance._templateContext : {}),
                ...dataContext,
                ...loopScope,
                ...this.globalData,
                $state: this.$state
            };

            for (const filterCallStr of filterCalls) {
                const { name: filterName, args: filterArgs } = this._parseFilterCall(
                    filterCallStr,
                    filterArgEvalContext
                );
                
                if (this.filters?.[filterName]) {
                    try {
                        value = this.filters[filterName](value, ...filterArgs);
                    } catch (e) {
                        console.error(`Spandrix: Error in filter "${filterName}":`, e);
                    }
                } else {
                    console.warn(`Spandrix: Filter "${filterName}" not found.`);
                }
            }

            if (isRaw) {
                if (!this.options.allowRawHTML) {
                    console.warn(`Spandrix: Raw HTML disabled for {{{ ${expression} }}}`);
                    return this.options.missingValuePlaceholder;
                }
                return String(value ?? '');
            }
            
            const stringValue = (value === undefined || value === null)
                ? this.options.missingValuePlaceholder
                : (typeof value === 'object' ? JSON.stringify(value) : String(value));
            
            return this._sanitizeHTML(stringValue);
        });
    }

    _evaluateCondition(expression, dataContext, componentInstance, additionalScope = {}) {
        const result = this._buildScopedEvaluator(
            expression,
            dataContext,
            componentInstance,
            additionalScope
        )();
        return !!result;
    }

    _createEventHandler(element, handlerExpression, dataContext, componentInstance, loopScope = {}) {
        const match = handlerExpression.match(/^([\w$.]+)(?:\(([\s\S]*)\))?$/);
        if (!match) {
            console.warn(`Spandrix: Invalid event handler: "${handlerExpression}"`);
            return null;
        }

        const handlerNameOrPath = match[1];
        const argsString = match[2] || "";

        const getHandlerFn = this._buildScopedEvaluator(
            handlerNameOrPath,
            dataContext,
            componentInstance,
            loopScope
        );

        return (event) => {
            const handlerFnInstance = getHandlerFn();
            
            if (typeof handlerFnInstance !== 'function') {
                console.warn(`Spandrix: Handler "${handlerNameOrPath}" not found.`);
                return;
            }

            const argEvalContext = { ...loopScope, '$event': event };
            const resolvedArgs = argsString.split(',')
                .map(arg => arg.trim())
                .filter(arg => arg)
                .map(argStr => {
                    if (argStr === '$event') return event;
                    return this._buildScopedEvaluator(
                        argStr,
                        dataContext,
                        componentInstance,
                        argEvalContext
                    )();
                });

            try {
                let methodOwnerContext = componentInstance 
                    ? componentInstance._templateContext 
                    : dataContext;
                
                if (handlerNameOrPath.includes('.')) {
                    const pathParts = handlerNameOrPath.split('.');
                    pathParts.pop();
                    if (pathParts.length > 0) {
                        methodOwnerContext = this._buildScopedEvaluator(
                            pathParts.join('.'),
                            dataContext,
                            componentInstance,
                            loopScope
                        )();
                    }
                }
                
                handlerFnInstance.apply(methodOwnerContext, resolvedArgs);
            } catch (e) {
                console.error(`Spandrix: Error executing "${handlerNameOrPath}":`, e);
            }
        };
    }

    _cleanupEventListenersBoundWithin(hostElementOrComponentId) {
        if (!this._eventListeners) return;
        
        const isId = typeof hostElementOrComponentId === 'string';
        this._eventListeners = this._eventListeners.filter(({ element, type, handler, componentId }) => {
            const match = isId
                ? (componentId === hostElementOrComponentId)
                : (hostElementOrComponentId === element || 
                   hostElementOrComponentId.contains(element));

            if (match) {
                element.removeEventListener(type, handler);
                this._logDebug('Cleaned event listener on', element, type);
                return false;
            }
            return true;
        });
    }

    _cleanupAllEventListeners() {
        this._logDebug('Cleaning up ALL event listeners.');
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
                try {
                    hookFn.call(context || this, ...args);
                } catch (e) {
                    console.error(`Spandrix: Error in hook '${hookName}':`, e);
                }
            });
        }
    }

    addHook(hookName, hookFn) {
        if (this._hooks[hookName] && typeof hookFn === 'function') {
            this._hooks[hookName].push(hookFn);
            this._logDebug(`Added hook to '${hookName}'`);
        } else {
            console.warn(`Spandrix: Unknown hook '${hookName}' or invalid function.`);
        }
    }

    _registerCoreDirectives() {
        this._directives.set('if', this._processIfDirective.bind(this));
        this._directives.set('show', this._processShowDirective.bind(this));
        this._directives.set('repeat', this._processRepeatDirective.bind(this));
        this._directives.set('model', this._processDataModel.bind(this));
        this._directives.set('fetch', this._processFetchDirective.bind(this));
    }

    registerDirective(name, handler) {
        if (typeof handler !== 'function') {
            console.error(`Spandrix: Directive "${name}" must be a function.`);
            return;
        }
        this._directives.set(name, handler);
        this._logDebug(`Registered directive: data-${name}`);
    }

    _extractKeysFromExpression(expression) {
        const keys = new Set();
        const varRegex = /(?<!\.)\b([a-zA-Z$_][\w$]*)\b(?!\s*\()/g;
        let match;
        
        while ((match = varRegex.exec(expression)) !== null) {
            const potentialKey = match[1];
            const excludedKeys = [
                'true', 'false', 'null', 'undefined', 'in', 'of', 'NaN', 'Infinity',
                '$state', 'globalData', '$event', '$index', 'item', 'key', 'value',
                ...Object.keys(this.filters || {})
            ];
            
            if (!excludedKeys.includes(potentialKey) && !/^\d/.test(potentialKey)) {
                keys.add(potentialKey);
            }
        }
        
        return Array.from(keys);
    }

    _processIfDirective(el, conditionExpr, dataContext, componentInstance, loopScope = {}, parentFragment = null) {
        const currentParent = el.parentNode || parentFragment;
        if (!currentParent) {
            this._logDebug(`data-if on <${el.tagName}> has no parent.`);
            return el;
        }

        if (!el._spxIfPlaceholderNode) {
            el._spxIfPlaceholderNode = document.createComment(
                `spx-if: ${conditionExpr} (id: ${this._generateComponentId()})`
            );
        }
        const placeholder = el._spxIfPlaceholderNode;
        
        if (!el._spxIfOriginalTemplateNode) {
            el._spxIfOriginalTemplateNode = el.cloneNode(true);
            el._spxIfOriginalTemplateNode.removeAttribute('data-if');
        }

        const evaluator = this._buildScopedEvaluator(
            conditionExpr,
            dataContext,
            componentInstance,
            loopScope
        );
        let returnedNode = el;

        const updateIfBlock = () => {
            const shouldBeVisible = evaluator();
            const isActualElementInParent = el.parentNode === currentParent ||
                (parentFragment && Array.from(parentFragment.childNodes).includes(el));
            const isPlaceholderInParent = placeholder.parentNode === currentParent ||
                (parentFragment && Array.from(parentFragment.childNodes).includes(placeholder));

            if (shouldBeVisible) {
                if (isPlaceholderInParent) {
                    const freshElement = el._spxIfOriginalTemplateNode.cloneNode(true);
                    freshElement._spxIfPlaceholderNode = placeholder;
                    freshElement._spxIfOriginalTemplateNode = el._spxIfOriginalTemplateNode;
                    freshElement._spxIfWatchersAttached = el._spxIfWatchersAttached;

                    currentParent.replaceChild(freshElement, placeholder);
                    this._processNode(freshElement, dataContext, componentInstance, loopScope, parentFragment);
                    returnedNode = freshElement;
                } else if (!isActualElementInParent && currentParent) {
                    const freshElement = el._spxIfOriginalTemplateNode.cloneNode(true);
                    freshElement._spxIfPlaceholderNode = placeholder;
                    freshElement._spxIfOriginalTemplateNode = el._spxIfOriginalTemplateNode;
                    const targetAppendParent = parentFragment || currentParent;
                    targetAppendParent.appendChild(freshElement);
                    this._processNode(freshElement, dataContext, componentInstance, loopScope, parentFragment);
                    returnedNode = freshElement;
                } else if (isActualElementInParent) {
                    Array.from(el.childNodes).forEach(child =>
                        this._processNode(child, dataContext, componentInstance, loopScope, parentFragment || el)
                    );
                    returnedNode = el;
                }
            } else {
                if (isActualElementInParent) {
                    this._cleanupEventListenersBoundWithin(el);
                    currentParent.replaceChild(placeholder, el);
                    returnedNode = placeholder;
                } else if (!isPlaceholderInParent && currentParent) {
                    currentParent.appendChild(placeholder);
                    returnedNode = placeholder;
                } else {
                    returnedNode = placeholder;
                }
            }
        };

        if (!el._spxIfWatchersAttached) {
            const reactiveKeys = this._extractKeysFromExpression(conditionExpr);
            reactiveKeys.forEach(key => {
                if (componentInstance) {
                    this._addWatcher(componentInstance, key, updateIfBlock);
                }
            });
            el._spxIfWatchersAttached = true;
        }

        updateIfBlock();
        return returnedNode;
    }

    _processShowDirective(el, conditionExpr, dataContext, componentInstance, loopScope = {}) {
        const shouldShow = this._evaluateCondition(
            conditionExpr,
            dataContext,
            componentInstance,
            loopScope
        );
        el.style.display = shouldShow ? '' : 'none';
    }

    _processRepeatDirective(node, dataContext, componentInstance, parentLoopScope, parentFragmentContext = null) {
        const repeatExpr = node.getAttribute('data-repeat').trim();
        let itemVar = 'item', indexOrKeyVar = '$index', actualIndexVar = null, collectionExpr = repeatExpr;

        const inMatch = repeatExpr.match(/^(.*?)\s+in\s+(.+)$/);
        if (!inMatch) {
            console.warn(`Spandrix data-repeat: Invalid expression "${repeatExpr}"`);
            return;
        }
        
        collectionExpr = inMatch[2].trim();
        const loopVarsStr = inMatch[1].trim().replace(/[()]/g, '');
        const loopVars = loopVarsStr.split(',').map(v => v.trim());

        itemVar = loopVars[0];
        if (loopVars.length > 1) indexOrKeyVar = loopVars[1];
        if (loopVars.length > 2) actualIndexVar = loopVars[2];

        const items = this._buildScopedEvaluator(
            collectionExpr,
            dataContext,
            componentInstance,
            parentLoopScope
        )();
        
        const effectiveParent = node.parentNode || parentFragmentContext;
        if (!effectiveParent) {
            this._logDebug(`data-repeat on <${node.tagName}> has no parent.`);
            return;
        }

        let templateElement, anchorNode = node._spxRepeatAnchor;

        if (!anchorNode) {
            templateElement = node.cloneNode(true);
            templateElement.removeAttribute('data-repeat');
            templateElement.style.display = '';
            anchorNode = document.createComment(
                `spx-repeat: ${repeatExpr} (id: ${this._generateComponentId()})`
            );
            effectiveParent.replaceChild(anchorNode, node);
            anchorNode._spxRepeatTemplate = templateElement;
            node._spxRepeatAnchor = anchorNode;
        } else {
            templateElement = anchorNode._spxRepeatTemplate;
        }

        let currentSibling = anchorNode.nextSibling;
        while (currentSibling && currentSibling._spxRepeatItemFor === anchorNode) {
            const toRemove = currentSibling;
            currentSibling = currentSibling.nextSibling;
            this._cleanupEventListenersBoundWithin(toRemove);
            toRemove.remove();
        }

        if (!items || typeof items !== 'object' || Object.keys(items).length === 0) {
            this._logDebug(`data-repeat for "${collectionExpr}" resulted in empty items.`);
            return;
        }

        const fragmentToInsert = document.createDocumentFragment();

        const processSingleItem = (itemValue, keyOrIndexValue, actualIndexValueIfObjectLoop) => {
            const clone = templateElement.cloneNode(true);
            const loopItemScope = { ...parentLoopScope };
            loopItemScope[itemVar] = itemValue;
            loopItemScope[indexOrKeyVar] = keyOrIndexValue;
            if (actualIndexVar && actualIndexValueIfObjectLoop !== undefined) {
                loopItemScope[actualIndexVar] = actualIndexValueIfObjectLoop;
            }
            clone._spxRepeatItemFor = anchorNode;
            this._processNode(clone, dataContext, componentInstance, loopItemScope, fragmentToInsert);
            fragmentToInsert.appendChild(clone);
        };

        if (Array.isArray(items)) {
            items.forEach((item, idx) => processSingleItem(item, idx));
        } else {
            Object.keys(items).forEach((key, idx) => {
                if (Object.prototype.hasOwnProperty.call(items, key)) {
                    processSingleItem(items[key], key, idx);
                }
            });
        }
        
        effectiveParent.insertBefore(fragmentToInsert, anchorNode.nextSibling);
    }

    _processDataModel(inputElement, modelKey, dataContext, componentInstance, loopScope = {}) {
        const resolvedModelPath = modelKey;
        let targetObjectForUpdate;
        let baseContextForRead;
        let effectiveKey = resolvedModelPath;

        if (resolvedModelPath.startsWith('$state.')) {
            targetObjectForUpdate = this.$state;
            baseContextForRead = this.$state;
            effectiveKey = resolvedModelPath.substring(7);
        } else if (resolvedModelPath.startsWith('globalData.')) {
            targetObjectForUpdate = this.globalData;
            baseContextForRead = this.globalData;
            effectiveKey = resolvedModelPath.substring(11);
        } else if (componentInstance) {
            baseContextForRead = componentInstance._templateContext;
            
            if (loopScope && Object.prototype.hasOwnProperty.call(loopScope, resolvedModelPath)) {
                targetObjectForUpdate = loopScope;
                console.warn(
                    `Spandrix: data-model="${resolvedModelPath}" targets loop variable. ` +
                    `Two-way binding may not update original collection.`
                );
            } else if (componentInstance._componentData && 
                       (resolvedModelPath in componentInstance._componentData)) {
                targetObjectForUpdate = componentInstance._componentData;
            } else if (componentInstance.$props && 
                       resolvedModelPath in componentInstance.$props &&
                       componentInstance._componentDef.model?.prop === resolvedModelPath) {
                targetObjectForUpdate = null;
            } else if (componentInstance.$props && resolvedModelPath in componentInstance.$props) {
                console.warn(
                    `Spandrix: data-model="${resolvedModelPath}" targets prop directly. ` +
                    `This is one-way binding.`
                );
                targetObjectForUpdate = null;
            } else {
                targetObjectForUpdate = componentInstance._componentData;
            }
        } else {
            baseContextForRead = dataContext;
            targetObjectForUpdate = dataContext;
            effectiveKey = resolvedModelPath;
        }

        let currentValue = this._getValueByPath(baseContextForRead, effectiveKey);

        if (inputElement.type === 'checkbox') {
            inputElement.checked = !!currentValue;
        } else if (inputElement.type === 'radio') {
            inputElement.checked = (String(inputElement.value) === String(currentValue));
        } else {
            inputElement.value = (currentValue !== undefined && currentValue !== null) 
                ? String(currentValue) 
                : '';
        }

        const eventName = (inputElement.tagName === 'SELECT' || 
                          inputElement.type === 'checkbox' || 
                          inputElement.type === 'radio') ? 'change' : 'input';

        if (inputElement._spx_data_model_handler) {
            inputElement.removeEventListener(
                inputElement._spx_data_model_event_type,
                inputElement._spx_data_model_handler
            );
            this._eventListeners = this._eventListeners.filter(
                l => l.handler !== inputElement._spx_data_model_handler
            );
        }

        const modelUpdateHandler = (event) => {
            let newValue;
            const targetInput = event.target;
            
            if (targetInput.type === 'checkbox') {
                newValue = targetInput.checked;
            } else if (targetInput.type === 'radio') {
                if (!targetInput.checked) return;
                newValue = targetInput.value;
            } else {
                newValue = targetInput.value;
            }

            const originalValueAtPath = this._getValueByPath(baseContextForRead, effectiveKey);
            if (typeof originalValueAtPath === 'number' && !isNaN(parseFloat(newValue))) {
                newValue = parseFloat(newValue);
            } else if (typeof originalValueAtPath === 'boolean') {
                newValue = (newValue === 'true' || newValue === true);
            }

            if (targetObjectForUpdate) {
                this._setValueByPath(targetObjectForUpdate, effectiveKey, newValue);
            } else if (componentInstance && 
                       componentInstance._componentDef.model && 
                       componentInstance._componentDef.model.prop === resolvedModelPath) {
                componentInstance.$emit(
                    componentInstance._componentDef.model.event || `update:${resolvedModelPath}`,
                    newValue
                );
            }
        };

        inputElement.addEventListener(eventName, modelUpdateHandler);
        this._eventListeners.push({
            element: inputElement,
            type: eventName,
            handler: modelUpdateHandler,
            componentId: componentInstance ? componentInstance._componentId : null
        });
        inputElement._spx_data_model_handler = modelUpdateHandler;
        inputElement._spx_data_model_event_type = eventName;
    }

    _processNode(node, dataContext, componentInstance = null, currentLoopScope = {}, parentFragment = null) {
        if (this._recursionDepth > this.options.maxRecursionDepth) {
            console.error('Spandrix: Max recursion depth exceeded');
            return node;
        }
        this._recursionDepth++;

        try {
            const newProcessingSignature = JSON.stringify({
                dataContextIdentity: dataContext === this._currentRootData 
                    ? 'root' 
                    : (componentInstance ? componentInstance._componentId : 'other'),
                loopScope: currentLoopScope
            });

            if (node._spxProcessedSignature === newProcessingSignature && node.parentNode) {
                this._recursionDepth--;
                return node;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                node._spxProcessedSignature = null;
            }

            let currentNodeToProcess = node;

            if (currentNodeToProcess.nodeType === Node.ELEMENT_NODE) {
                const ifAttr = currentNodeToProcess.getAttribute('data-if');
                if (ifAttr) {
                    currentNodeToProcess = this._processIfDirective(
                        currentNodeToProcess,
                        ifAttr,
                        dataContext,
                        componentInstance,
                        currentLoopScope,
                        parentFragment
                    );
                    if (currentNodeToProcess.nodeType === Node.COMMENT_NODE) {
                        currentNodeToProcess._spxProcessedSignature = newProcessingSignature;
                        this._recursionDepth--;
                        return currentNodeToProcess;
                    }
                }

                const tagName = currentNodeToProcess.tagName.toLowerCase();
                const componentDef = this.components[tagName];
                if (componentDef) {
                    this._renderComponent(
                        currentNodeToProcess,
                        tagName,
                        dataContext,
                        componentInstance,
                        currentLoopScope
                    );
                    currentNodeToProcess._spxProcessedSignature = newProcessingSignature;
                    this._recursionDepth--;
                    return currentNodeToProcess;
                }

                if (currentNodeToProcess.hasAttribute('data-repeat')) {
                    this._processRepeatDirective(
                        currentNodeToProcess,
                        dataContext,
                        componentInstance,
                        currentLoopScope,
                        parentFragment
                    );
                    const anchor = currentNodeToProcess._spxRepeatAnchor || currentNodeToProcess;
                    anchor._spxProcessedSignature = newProcessingSignature;
                    this._recursionDepth--;
                    return anchor;
                }

                const showAttr = currentNodeToProcess.getAttribute('data-show');
                if (showAttr) {
                    this._processShowDirective(
                        currentNodeToProcess,
                        showAttr,
                        dataContext,
                        componentInstance,
                        currentLoopScope
                    );
                }

                Array.from(currentNodeToProcess.attributes).forEach(attr => {
                    const { name: attrName, value: attrValue } = attr;
                    
                    if (attrName.startsWith('data-on:')) {
                        const eventType = attrName.slice(8);
                        if (!currentNodeToProcess._spx_event_listeners || 
                            !currentNodeToProcess._spx_event_listeners[eventType]) {
                            const eventHandlerFn = this._createEventHandler(
                                currentNodeToProcess,
                                attrValue,
                                dataContext,
                                componentInstance,
                                currentLoopScope
                            );
                            if (eventHandlerFn) {
                                currentNodeToProcess.addEventListener(eventType, eventHandlerFn);
                                this._eventListeners.push({
                                    element: currentNodeToProcess,
                                    type: eventType,
                                    handler: eventHandlerFn,
                                    componentId: componentInstance ? componentInstance._componentId : null
                                });
                                currentNodeToProcess._spx_event_listeners = 
                                    currentNodeToProcess._spx_event_listeners || {};
                                currentNodeToProcess._spx_event_listeners[eventType] = eventHandlerFn;
                            }
                        }
                    } else if (attrName === 'data-model' && 
                               /^(INPUT|TEXTAREA|SELECT)$/.test(currentNodeToProcess.tagName)) {
                        this._processDataModel(
                            currentNodeToProcess,
                            attrValue,
                            dataContext,
                            componentInstance,
                            currentLoopScope
                        );
                    } else if (attrName.startsWith(':') || attrName.startsWith('data-bind:')) {
                        const bindAttr = attrName.startsWith(':') 
                            ? attrName.slice(1) 
                            : attrName.slice(10);
                        let val = this._buildScopedEvaluator(
                            attrValue,
                            dataContext,
                            componentInstance,
                            currentLoopScope
                        )();

                        if (bindAttr === 'class') {
                            const staticClasses = currentNodeToProcess._spx_static_class ?? 
                                Array.from(currentNodeToProcess.classList)
                                    .filter(c => !c.startsWith('spx-dynamic-'))
                                    .join(' ');
                            currentNodeToProcess._spx_static_class = staticClasses;
                            
                            let dynamicClasses = '';
                            if (typeof val === 'string') {
                                dynamicClasses = val;
                            } else if (Array.isArray(val)) {
                                dynamicClasses = val.join(' ');
                            } else if (typeof val === 'object' && val !== null) {
                                dynamicClasses = Object.keys(val).filter(k => val[k]).join(' ');
                            }
                            currentNodeToProcess.className = 
                                (staticClasses + ' ' + dynamicClasses).trim().replace(/\s+/g, ' ');
                        } else if (bindAttr === 'style') {
                            if (typeof val === 'object' && val !== null) {
                                Object.keys(val).forEach(styleKey =>
                                    currentNodeToProcess.style[this._camelCase(styleKey)] = val[styleKey]
                                );
                            } else if (typeof val === 'string') {
                                currentNodeToProcess.style.cssText = val;
                            }
                        } else if (typeof val === 'boolean') {
                            val ? currentNodeToProcess.setAttribute(bindAttr, '') 
                                : currentNodeToProcess.removeAttribute(bindAttr);
                        } else if (val !== undefined && val !== null) {
                            currentNodeToProcess.setAttribute(bindAttr, String(val));
                        } else {
                            currentNodeToProcess.removeAttribute(bindAttr);
                        }
                    } else if (!attrName.startsWith('data-') && 
                               (attrValue.includes('{{') || attrValue.includes('{{{'))) {
                        const interpolatedValue = this._interpolateString(
                            attrValue,
                            dataContext,
                            componentInstance,
                            currentLoopScope
                        );
                        if (currentNodeToProcess.getAttribute(attrName) !== interpolatedValue) {
                            currentNodeToProcess.setAttribute(attrName, interpolatedValue);
                        }
                    }
                });

                if (currentNodeToProcess.hasAttribute('data-fetch')) {
                    this._processFetchDirective(
                        currentNodeToProcess,
                        dataContext,
                        componentInstance,
                        currentLoopScope
                    );
                }

                if (currentNodeToProcess.hasAttribute('data-text')) {
                    currentNodeToProcess.textContent = this._interpolateString(
                        `{{${currentNodeToProcess.getAttribute('data-text')}}}`,
                        dataContext,
                        componentInstance,
                        currentLoopScope
                    );
                    currentNodeToProcess._spxProcessedSignature = newProcessingSignature;
                    this._recursionDepth--;
                    return currentNodeToProcess;
                }
                
                if (currentNodeToProcess.hasAttribute('data-html')) {
                    if (this.options.allowRawHTML) {
                        currentNodeToProcess.innerHTML = this._interpolateString(
                            `{{{${currentNodeToProcess.getAttribute('data-html')}}}}`,
                            dataContext,
                            componentInstance,
                            currentLoopScope
                        );
                    } else {
                        currentNodeToProcess.textContent = this.options.missingValuePlaceholder;
                        console.warn('Spandrix: data-html used but allowRawHTML is false.');
                    }
                    currentNodeToProcess._spxProcessedSignature = newProcessingSignature;
                    this._recursionDepth--;
                    return currentNodeToProcess;
                }
                
                if (currentNodeToProcess.hasAttribute('data-safe-html')) {
                    currentNodeToProcess.innerHTML = this._sanitizeHTML(
                        this._interpolateString(
                            `{{{${currentNodeToProcess.getAttribute('data-safe-html')}}}}`,
                            dataContext,
                            componentInstance,
                            currentLoopScope
                        )
                    );
                    currentNodeToProcess._spxProcessedSignature = newProcessingSignature;
                    this._recursionDepth--;
                    return currentNodeToProcess;
                }
            }

            if (currentNodeToProcess.nodeType === Node.ELEMENT_NODE || 
                currentNodeToProcess.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                const children = Array.from(currentNodeToProcess.childNodes);
                
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    let processedChild;

                    if (child.nodeType === Node.TEXT_NODE && 
                        (child.nodeValue.includes('{{') || child.nodeValue.includes('{{{'))) {
                        child._spxProcessedSignature = null;
                        const originalValue = child.nodeValue;
                        const interpolated = this._interpolateString(
                            originalValue,
                            dataContext,
                            componentInstance,
                            currentLoopScope
                        );
                        if (interpolated !== originalValue) {
                            child.nodeValue = interpolated;
                        }
                        processedChild = child;
                    } else if (child.nodeType === Node.ELEMENT_NODE) {
                        processedChild = this._processNode(
                            child,
                            dataContext,
                            componentInstance,
                            currentLoopScope,
                            (currentNodeToProcess.nodeType === Node.DOCUMENT_FRAGMENT_NODE 
                                ? currentNodeToProcess 
                                : parentFragment)
                        );
                    } else {
                        processedChild = child;
                    }

                    if (processedChild !== child && child.parentNode === currentNodeToProcess) {
                        currentNodeToProcess.replaceChild(processedChild, child);
                    }
                }
            }

            currentNodeToProcess._spxProcessedSignature = newProcessingSignature;
            this._recursionDepth--;
            return currentNodeToProcess;
        } catch (error) {
            console.error('Spandrix: Error processing node:', error);
            this._recursionDepth--;
            return node;
        }
    }

    _processFetchDirective(node, dataContext, componentInstance, loopScope = {}) {
        const fetchUrlRaw = node.getAttribute('data-fetch');
        if (!fetchUrlRaw) return;

        const contextForInterpolation = componentInstance 
            ? componentInstance._templateContext 
            : dataContext;
        const fetchUrl = this._interpolateString(
            fetchUrlRaw,
            contextForInterpolation,
            componentInstance,
            loopScope
        );

        const fetchAs = node.getAttribute('data-fetch-as') || 'fetchedData';
        const fetchMethod = (node.getAttribute('data-fetch-method') || 'GET').toUpperCase();
        const fetchLoadingClass = node.getAttribute('data-fetch-loading-class');
        const fetchErrorClass = node.getAttribute('data-fetch-error-class');
        const cacheAttr = node.getAttribute('data-fetch-cache');
        const explicitNoCache = (cacheAttr === 'false');

        let targetContextObject, effectiveFetchAsKey = fetchAs;

        if (fetchAs.startsWith('$state.')) {
            targetContextObject = this.$state;
            effectiveFetchAsKey = fetchAs.substring(7);
        } else if (fetchAs.startsWith('globalData.')) {
            targetContextObject = this.globalData;
            effectiveFetchAsKey = fetchAs.substring(11);
        } else if (componentInstance) {
            targetContextObject = componentInstance._componentData;
        } else {
            targetContextObject = dataContext;
        }

        let fetchStateContainer = this._getValueByPath(targetContextObject, effectiveFetchAsKey);
        
        if (!fetchStateContainer || typeof fetchStateContainer !== 'object' || 
            !fetchStateContainer._isReactiveProxy) {
            const newContainer = this._makeReactive(
                {
                    $loading: false,
                    $error: null,
                    data: null,
                    _spxLastFetchId: null,
                    _spxLastFetchCompletedSuccessfully: false,
                    _spxIsCurrentlyFetching: false
                },
                (changedObject, changedKey, newValue, oldValue) => {
                    this._logDebug(
                        `data-fetch: State change in '${effectiveFetchAsKey}.${String(changedKey)}'`
                    );
                    if (componentInstance && componentInstance._mounted) {
                        componentInstance.$update();
                    } else if (targetContextObject === this._currentRootData || 
                               dataContext === this._currentRootData) {
                        this._scheduleRootReRender();
                    }
                },
                `fetchState_${effectiveFetchAsKey}`
            );
            this._setValueByPath(targetContextObject, effectiveFetchAsKey, newContainer);
            fetchStateContainer = newContainer;
        } else if (fetchStateContainer._spxIsCurrentlyFetching === undefined) {
            fetchStateContainer._spxIsCurrentlyFetching = false;
        }

        const fetchRequestId = JSON.stringify({ url: fetchUrl, method: fetchMethod });

        if (fetchStateContainer._spxLastFetchId === fetchRequestId &&
            fetchStateContainer._spxLastFetchCompletedSuccessfully &&
            !explicitNoCache) {
            this._logDebug('data-fetch: Using cached data for', fetchUrl);
            if (fetchStateContainer.$loading) fetchStateContainer.$loading = false;
            if (node._spx_node_is_fetching_this_request_id === fetchRequestId) {
                delete node._spx_node_is_fetching_this_request_id;
            }
            return;
        }

        if (node._spx_node_is_fetching_this_request_id === fetchRequestId ||
            (fetchStateContainer._spxIsCurrentlyFetching === true && 
             fetchStateContainer._spxLastFetchId === fetchRequestId)) {
            this._logDebug(`data-fetch: Already fetching ${fetchUrl}. Skipping.`);
            if (!fetchStateContainer.$loading) fetchStateContainer.$loading = true;
            if (fetchLoadingClass && node.classList && 
                !node.classList.contains(fetchLoadingClass)) {
                node.classList.add(fetchLoadingClass);
            }
            return;
        }

        this._logDebug(`data-fetch: Initiating fetch for ${fetchUrl}`);
        node._spx_node_is_fetching_this_request_id = fetchRequestId;
        fetchStateContainer._spxIsCurrentlyFetching = true;
        fetchStateContainer._spxLastFetchId = fetchRequestId;
        fetchStateContainer._spxLastFetchCompletedSuccessfully = false;
        fetchStateContainer.$loading = true;
        fetchStateContainer.$error = null;

        if (fetchLoadingClass && node.classList) {
            node.classList.add(fetchLoadingClass);
        }
        if (fetchErrorClass && node.classList) {
            node.classList.remove(fetchErrorClass);
        }

        this.request(fetchUrl, { method: fetchMethod })
            .then(data => {
                fetchStateContainer.data = data;
                fetchStateContainer.$error = null;
                fetchStateContainer._spxLastFetchCompletedSuccessfully = true;
            })
            .catch(error => {
                console.error(`Spandrix: data-fetch to "${fetchUrl}" failed:`, error);
                fetchStateContainer.data = null;
                fetchStateContainer.$error = error.message || String(error);
                if (fetchErrorClass && node.classList) {
                    node.classList.add(fetchErrorClass);
                }
            })
            .finally(() => {
                if (node._spx_node_is_fetching_this_request_id === fetchRequestId) {
                    delete node._spx_node_is_fetching_this_request_id;
                }
                if (fetchStateContainer._spxLastFetchId === fetchRequestId) {
                    fetchStateContainer._spxIsCurrentlyFetching = false;
                }
                fetchStateContainer.$loading = false;
                if (fetchLoadingClass && node.classList) {
                    node.classList.remove(fetchLoadingClass);
                }
            });
    }

    _renderComponent(hostElement, tagName, parentDataContext, parentComponentInstanceContext, parentLoopScope = {}) {
        const componentDef = this.components[tagName];
        if (!componentDef) return;

        const existingInstance = hostElement._spandrixComponent;

        if (existingInstance && existingInstance._componentDef._name === tagName) {
            const newPropsData = {};
            const propsDefForUpdate = existingInstance._componentDef._propsDef || {};
            let modelPropKeyForUpdate = null;
            let modelValueFromParent = undefined;
            let modelAttrValue = null;

            for (const attr of Array.from(hostElement.attributes)) {
                let attrName = attr.name;
                let attrValue = attr.value;
                let propKey = '';
                let isModel = false;
                let resolvedPropValue;

                if (attrName === 'data-model' && componentDef.model) {
                    isModel = true;
                    propKey = componentDef.model.prop || 'modelValue';
                    modelAttrValue = attrValue;
                    resolvedPropValue = this._buildScopedEvaluator(
                        attrValue,
                        parentDataContext,
                        parentComponentInstanceContext,
                        parentLoopScope
                    )();
                    modelPropKeyForUpdate = propKey;
                    modelValueFromParent = resolvedPropValue;
                } else if (attrName.startsWith(':') || attrName.startsWith('data-bind:')) {
                    let tempKey = attrName.startsWith(':') ? attrName.slice(1) : attrName.slice(10);
                    if (tempKey.endsWith('.sync')) tempKey = tempKey.slice(0, -5);
                    propKey = this._camelCase(tempKey);
                    resolvedPropValue = this._buildScopedEvaluator(
                        attrValue,
                        parentDataContext,
                        parentComponentInstanceContext,
                        parentLoopScope
                    )();
                } else {
                    const camelName = this._camelCase(attrName);
                    if (camelName in propsDefForUpdate) {
                        propKey = camelName;
                        resolvedPropValue = attrValue;
                    } else continue;
                }

                if (propKey && (propKey in propsDefForUpdate || 
                    (isModel && propKey === (componentDef.model?.prop || 'modelValue')))) {
                    newPropsData[propKey] = resolvedPropValue;
                }
            }

            for (const key in propsDefForUpdate) {
                if (newPropsData[key] === undefined && propsDefForUpdate[key].default !== undefined) {
                    const def = propsDefForUpdate[key].default;
                    newPropsData[key] = typeof def === 'function' ? def.call(null) : def;
                }
            }

            let propsChanged = false;
            for (const key in newPropsData) {
                if (JSON.stringify(existingInstance.$props[key]) !== JSON.stringify(newPropsData[key])) {
                    existingInstance.$props[key] = newPropsData[key];
                    propsChanged = true;
                }
            }

            for (const key in existingInstance.$props) {
                if (!(key in newPropsData) && key in propsDefForUpdate) {
                    delete existingInstance.$props[key];
                    propsChanged = true;
                }
            }

            if (propsChanged) existingInstance.$update();
            return;
        } else if (existingInstance) {
            this._destroyComponent(existingInstance);
            hostElement._spandrixComponent = null;
        }

        this._cleanupEventListenersBoundWithin(hostElement);
        const propsDefinition = componentDef._propsDef || {};
        const propsData = {};
        const syncEventHandlers = [];
        let modelPropKey = null;
        let modelParentPath = null;

        for (const attr of Array.from(hostElement.attributes)) {
            let attrName = attr.name;
            let attrValue = attr.value;
            let propKey = '';
            let isSync = false;
            let isModel = false;
            let resolvedPropValue;

            if (attrName === 'data-model' && componentDef.model) {
                isModel = true;
                propKey = componentDef.model.prop || 'modelValue';
                modelParentPath = attrValue;
                modelPropKey = propKey;
                resolvedPropValue = this._buildScopedEvaluator(
                    attrValue,
                    parentDataContext,
                    parentComponentInstanceContext,
                    parentLoopScope
                )();
            } else if (attrName.startsWith(':') || attrName.startsWith('data-bind:')) {
                let tempKey = attrName.startsWith(':') ? attrName.slice(1) : attrName.slice(10);
                if (tempKey.endsWith('.sync')) {
                    isSync = true;
                    tempKey = tempKey.slice(0, -5);
                }
                propKey = this._camelCase(tempKey);
                resolvedPropValue = this._buildScopedEvaluator(
                    attrValue,
                    parentDataContext,
                    parentComponentInstanceContext,
                    parentLoopScope
                )();
            } else {
                const camelName = this._camelCase(attrName);
                if (camelName in propsDefinition) {
                    propKey = camelName;
                    resolvedPropValue = attrValue;
                } else continue;
            }

            if (propKey && (propKey in propsDefinition || 
                (isModel && propKey === (componentDef.model?.prop || 'modelValue')))) {
                propsData[propKey] = resolvedPropValue;
                
                if (isSync || isModel) {
                    const eventToListen = isModel 
                        ? (componentDef.model.event || `update:${propKey}`)
                        : `update:${propKey}`;
                    syncEventHandlers.push({
                        eventName: eventToListen,
                        parentPropertyPath: isModel ? modelParentPath : attrValue,
                        parentContextForUpdate: parentComponentInstanceContext 
                            ? parentComponentInstanceContext._componentData 
                            : parentDataContext,
                        isParentComponent: !!parentComponentInstanceContext
                    });
                }
            }
        }

        for (const key in propsDefinition) {
            if (propsData[key] === undefined && propsDefinition[key].default !== undefined) {
                const def = propsDefinition[key].default;
                propsData[key] = typeof def === 'function' ? def.call(null) : def;
            }
        }

        const componentId = this._generateComponentId();
        hostElement.setAttribute('data-spx-id', componentId);

        const componentInstance = {
            _isComponentInstance: true,
            _componentDef: componentDef,
            _componentId: componentId,
            _hostElement: hostElement,
            $el: hostElement,
            _parentDataContext: parentDataContext,
            _parentComponentInstance: parentComponentInstanceContext,
            _parentLoopScope: parentLoopScope,
            _watchers: [],
            _computedWatchers: {},
            _computedValuesCache: {},
            _mounted: false,
            _destroyed: false,
            $props: null,
            _componentData: null,
            $refs: {},
            $slots: {},
            $engine: this,
            $emit: (event, ...detail) => {
                if (componentInstance._destroyed) return;
                const customEvent = new CustomEvent(event, {
                    detail: detail.length === 1 ? detail[0] : detail,
                    bubbles: true,
                    composed: true
                });
                componentInstance.$el.dispatchEvent(customEvent);
            },
            $update: () => {
                if (componentInstance._destroyed || !componentInstance._mounted) return;
                this._logDebug(`<${componentDef._name}> (${componentId}) $update() called.`);
                this._callHook('beforeComponentUpdate', componentInstance._templateContext, componentInstance);
                this._updateComputedProperties(componentInstance);
                this._cleanupEventListenersBoundWithin(componentId);

                const contentFragment = this._compileComponentTemplate(componentInstance);
                componentInstance.$el.innerHTML = '';
                componentInstance.$el.appendChild(contentFragment);
                this._callHook('afterComponentUpdate', componentInstance._templateContext, componentInstance);
            },
            $watch: (path, cb) => this._addWatcher(componentInstance, path, cb),
            $destroy: () => this._destroyComponent(componentInstance)
        };

        hostElement._spandrixComponent = componentInstance;

        componentInstance.$slots = this._captureAndProcessSlots(
            hostElement,
            parentDataContext,
            parentComponentInstanceContext,
            parentLoopScope
        );

        if (hostElement._spxSyncListeners) {
            hostElement._spxSyncListeners.forEach(l => 
                hostElement.removeEventListener(l.event, l.handler)
            );
        }
        hostElement._spxSyncListeners = [];

        syncEventHandlers.forEach(syncInfo => {
            const handler = (event) => {
                const newValue = event.detail;
                const path = syncInfo.parentPropertyPath;
                let updateTargetContext = syncInfo.parentContextForUpdate;

                if (path.startsWith('$state.')) {
                    this.setState(path.substring(7), newValue);
                } else if (path.startsWith('globalData.')) {
                    this.globalData[path.substring(11)] = newValue;
                } else if (syncInfo.isParentComponent && updateTargetContext) {
                    this._setValueByPath(updateTargetContext, path, newValue);
                } else if (!syncInfo.isParentComponent && parentDataContext) {
                    this._setValueByPath(parentDataContext, path, newValue);
                }
            };
            componentInstance.$el.addEventListener(syncInfo.eventName, handler);
            hostElement._spxSyncListeners.push({ event: syncInfo.eventName, handler });
        });

        componentInstance.$props = this._makeReactive(propsData, (target, key, value, oldValue) => {
            this._logDebug(`<${tagName}> prop changed: ${String(key)}`, oldValue, '->', value);
            this._updateComputedProperties(componentInstance);
            if (componentDef.watch?.[key]) {
                componentDef.watch[key].call(componentInstance._templateContext, value, oldValue);
            }
            if (componentInstance._mounted) componentInstance.$update();
        }, `<${tagName}>.$props`);

        const initialData = typeof componentDef.data === 'function' 
            ? (componentDef.data.call(componentInstance) || {})
            : {};

        componentInstance._componentData = this._makeReactive(initialData, (target, key, value, oldValue) => {
            this._logDebug(`<${tagName}> data changed: ${String(key)}`, oldValue, '->', value);
            this._updateComputedProperties(componentInstance);
            
            componentInstance._watchers.forEach(w => {
                if (w.path === key || w.path.startsWith(key + '.')) {
                    const currentVal = this._getValueByPath(componentInstance._templateContext, w.path);
                    if (JSON.stringify(currentVal) !== JSON.stringify(w.oldValue)) {
                        w.callback.call(componentInstance._templateContext, currentVal, w.oldValue);
                        w.oldValue = this._deepClone(currentVal);
                    }
                }
            });
            
            if (componentDef.watch?.[key]) {
                componentDef.watch[key].call(componentInstance._templateContext, value, oldValue);
            }
            if (componentInstance._mounted) componentInstance.$update();
        }, `<${tagName}>._componentData`);

        const methodCache = {};
        componentInstance._templateContext = new Proxy(componentInstance, {
            get: (target, key) => {
                if (key === '_isReactiveProxy' || typeof key === 'symbol') {
                    return Reflect.get(target, key);
                }

                const directAccess = [
                    '_isComponentInstance', '_componentDef', '_componentId', '_hostElement',
                    '_parentDataContext', '_parentComponentInstance', '_parentLoopScope',
                    '_watchers', '_computedWatchers', '_computedValuesCache',
                    '_mounted', '_destroyed', '_componentData'
                ];
                if (directAccess.includes(String(key))) return target[key];

                const publicApi = [
                    '$el', '$props', '$slots', '$refs', '$engine',
                    '$emit', '$watch', '$destroy', '$update'
                ];
                if (publicApi.includes(String(key))) return target[key];

                if (String(key) === '$state') return target.$engine.$state;
                if (String(key) === 'globalData') return target.$engine.globalData;

                if (componentDef.methods && key in componentDef.methods) {
                    return methodCache[key] || 
                        (methodCache[key] = componentDef.methods[key].bind(target._templateContext));
                }

                if (componentDef.computed && key in componentDef.computed) {
                    if (!target._computedWatchers[key]?.isFresh) {
                        target.$engine._updateComputedProperties(target, String(key));
                    }
                    return target._computedValuesCache[key];
                }

                if (target._componentData && key in target._componentData) {
                    return target._componentData[key];
                }
                if (target.$props && key in target.$props) return target.$props[key];

                if (target._parentLoopScope && key in target._parentLoopScope) {
                    return target._parentLoopScope[key];
                }
                if (target.$engine.globalData && key in target.$engine.globalData) {
                    return target.$engine.globalData[key];
                }

                return undefined;
            },

            set: (target, key, value) => {
                if (typeof key === 'symbol') return Reflect.set(target, key, value);

                if (target._componentData && 
                    (key in target._componentData || typeof componentDef.data === 'function')) {
                    target._componentData[key] = value;
                    return true;
                }

                if (target.$props && key in target.$props) {
                    console.warn(
                        `Spandrix: Cannot set prop "${String(key)}" on <${componentDef._name}>. ` +
                        `Props are one-way.`
                    );
                    return false;
                }

                if (target._parentLoopScope && key in target._parentLoopScope &&
                    typeof target._parentLoopScope[key] === 'object' &&
                    target._parentLoopScope[key] !== null) {
                    target._parentLoopScope[key] = value;
                    return true;
                }

                if (target.$engine.$state && key in target.$engine.$state) {
                    target.$engine.$state[key] = value;
                    return true;
                }

                target[key] = value;
                return true;
            },

            has: (target, key) => {
                if (key in target) return true;
                if (componentDef.methods && key in componentDef.methods) return true;
                if (componentDef.computed && key in componentDef.computed) return true;
                if (target._componentData && key in target._componentData) return true;
                if (target.$props && key in target.$props) return true;
                if (target._parentLoopScope && key in target._parentLoopScope) return true;
                if (String(key) === '$state' || String(key) === 'globalData') return true;
                if (target.$engine.globalData && key in target.$engine.globalData) return true;
                return false;
            }
        });

        if (typeof componentDef.data === 'function') {
            const newData = componentDef.data.call(componentInstance._templateContext) || {};
            for (const dataKey in newData) {
                componentInstance._componentData[dataKey] = newData[dataKey];
            }
        }

        if (componentDef.computed) {
            for (const key in componentDef.computed) {
                const getter = (typeof componentDef.computed[key] === 'function')
                    ? componentDef.computed[key]
                    : componentDef.computed[key].get;
                componentInstance._computedWatchers[key] = {
                    fn: getter,
                    isFresh: false,
                    dependencies: this._extractKeysFromExpression(getter.toString())
                };
            }
            this._updateComputedProperties(componentInstance);
        }

        this._callHook('beforeComponentCreate', componentInstance._templateContext, componentInstance);
        if (componentDef.created) {
            try {
                componentDef.created.call(componentInstance._templateContext);
            } catch (e) {
                console.error(`Error in <${tagName}> created():`, e);
            }
        }
        this._callHook('afterComponentCreate', componentInstance._templateContext, componentInstance);

        const contentFragment = this._compileComponentTemplate(componentInstance);
        hostElement.innerHTML = '';
        hostElement.appendChild(contentFragment);

        this._callHook('beforeComponentMount', componentInstance._templateContext, componentInstance);
        Promise.resolve().then(() => {
            if (!componentInstance._destroyed && document.body.contains(hostElement)) {
                componentInstance._mounted = true;
                if (componentDef.mounted) {
                    try {
                        componentDef.mounted.call(componentInstance._templateContext);
                    } catch (e) {
                        console.error(`Error in <${tagName}> mounted():`, e);
                    }
                }
                this._callHook('afterComponentMount', componentInstance._templateContext, componentInstance);
            }
        });
    }

    _captureAndProcessSlots(hostElement, parentDataContext, parentComponentInstance, parentLoopScope) {
        const capturedSlots = { default: [] };
        const tempFragmentForOriginalContent = document.createDocumentFragment();
        
        while (hostElement.firstChild) {
            tempFragmentForOriginalContent.appendChild(hostElement.firstChild);
        }

        Array.from(tempFragmentForOriginalContent.childNodes).forEach(originalNode => {
            if (originalNode.nodeType === Node.TEXT_NODE && 
                originalNode.nodeValue.trim() === '') {
                return;
            }

            let slotName = 'default';
            let isTemplateSlotSyntax = false;

            if (originalNode.nodeType === Node.ELEMENT_NODE) {
                const elTag = originalNode.tagName.toLowerCase();
                if (elTag === 'template' && 
                    (originalNode.hasAttribute('slot') || 
                     originalNode.getAttributeNames().some(attr => 
                         attr.startsWith('v-slot:') || attr.startsWith('#')))) {
                    isTemplateSlotSyntax = true;
                    const slotAttr = originalNode.getAttribute('slot') || 
                        originalNode.getAttributeNames().find(attr => 
                            attr.startsWith('v-slot:') || attr.startsWith('#'));
                    if (slotAttr) {
                        const nameMatch = slotAttr.match(/^(?:v-slot:|#)?([^=]+)/);
                        slotName = (nameMatch && nameMatch[1] && nameMatch[1].trim() !== '')
                            ? nameMatch[1].trim()
                            : 'default';
                    }
                } else if (originalNode.hasAttribute('slot')) {
                    slotName = originalNode.getAttribute('slot') || 'default';
                }
            }
            
            slotName = slotName.toLowerCase();

            if (!capturedSlots[slotName]) capturedSlots[slotName] = [];

            const nodesToProcessForSlot = isTemplateSlotSyntax
                ? Array.from(originalNode.content.childNodes)
                : [originalNode];

            nodesToProcessForSlot.forEach(contentNode => {
                const clonedNodeForProcessing = contentNode.cloneNode(true);
                if (clonedNodeForProcessing.nodeType === Node.ELEMENT_NODE) {
                    clonedNodeForProcessing.removeAttribute('slot');
                }

                const tempFragmentForProcessing = document.createDocumentFragment();
                const returnedNodeFromProcess = this._processNode(
                    clonedNodeForProcessing,
                    parentComponentInstance ? parentComponentInstance._templateContext : parentDataContext,
                    parentComponentInstance,
                    parentLoopScope,
                    tempFragmentForProcessing
                );

                if (tempFragmentForProcessing.hasChildNodes()) {
                    Array.from(tempFragmentForProcessing.childNodes).forEach(finalNode => {
                        capturedSlots[slotName].push(finalNode);
                    });
                } else if (returnedNodeFromProcess && returnedNodeFromProcess.nodeType !== undefined) {
                    capturedSlots[slotName].push(returnedNodeFromProcess);
                }
            });
        });

        return capturedSlots;
    }

    _compileComponentTemplate(componentInstance) {
        const componentDef = componentInstance._componentDef;
        const templateString = typeof componentDef.template === 'function'
            ? componentDef.template.call(componentInstance._templateContext)
            : componentDef.template;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.convertToSpandrixSyntax(templateString);
        const fragment = document.createDocumentFragment();

        Array.from(tempDiv.childNodes).forEach(node => {
            const processed = this._processNode(
                node.cloneNode(true),
                componentInstance._templateContext,
                componentInstance,
                {},
                fragment
            );
            fragment.appendChild(processed);
        });

        const slotElements = fragment.querySelectorAll('slot');
        slotElements.forEach(slotEl => {
            const slotName = (slotEl.getAttribute('name') || 'default').toLowerCase();
            const assignedNodes = componentInstance.$slots[slotName] || [];

            if (assignedNodes.length > 0) {
                assignedNodes.forEach(n => {
                    const clone = n.cloneNode(true);
                    slotEl.parentNode.insertBefore(clone, slotEl);
                });
            }
            slotEl.remove();
        });

        return fragment;
    }

    _updateComputedProperties(componentInstance, specificKey = null) {
        if (!componentInstance || !componentInstance._componentDef.computed || 
            componentInstance._destroyed) {
            return false;
        }

        let changed = false;
        const contextToCall = componentInstance._templateContext;
        const keysToUpdate = specificKey 
            ? [specificKey] 
            : Object.keys(componentInstance._componentDef.computed);

        for (const key of keysToUpdate) {
            if (!Object.prototype.hasOwnProperty.call(componentInstance._componentDef.computed, key)) {
                continue;
            }

            const computedWatcher = componentInstance._computedWatchers[key];
            if (computedWatcher && typeof computedWatcher.fn === 'function') {
                const oldVal = componentInstance._computedValuesCache[key];
                const newVal = computedWatcher.fn.call(contextToCall);

                if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                    componentInstance._computedValuesCache[key] = newVal;
                    changed = true;
                    this._logDebug(
                        `[Computed: ${key}] in <${componentInstance._componentDef._name}> updated to:`,
                        newVal
                    );

                    componentInstance._watchers.forEach(w => {
                        if (w.path === key) {
                            try {
                                w.callback.call(contextToCall, newVal, oldVal);
                            } catch (e) {
                                console.error(
                                    `Spandrix: $watch error for computed "${key}" ` +
                                    `in <${componentInstance._componentDef._name}>:`, e
                                );
                            }
                            w.oldValue = this._deepClone(newVal);
                        }
                    });

                    if (componentInstance._componentDef.watch && 
                        typeof componentInstance._componentDef.watch[key] === 'function') {
                        try {
                            componentInstance._componentDef.watch[key].call(contextToCall, newVal, oldVal);
                        } catch (e) {
                            console.error(
                                `Error in watcher for computed '${key}' ` +
                                `in <${componentInstance._componentDef._name}>:`, e
                            );
                        }
                    }
                }
                computedWatcher.isFresh = true;
            }
        }
        return changed;
    }

    _destroyComponent(componentInstance) {
        if (!componentInstance || componentInstance._destroyed) return;

        const { _componentDef: compDef, _componentId: compId, _templateContext: contextToCall = componentInstance } = componentInstance;
        this._logDebug(`Destroying component <${compDef?._name || 'Unknown'}> (ID: ${compId})`);

        this._callHook('beforeComponentDestroy', contextToCall, componentInstance);
        if (compDef?.beforeDestroy) {
            try {
                compDef.beforeDestroy.call(contextToCall);
            } catch (e) {
                console.error(`Error in <${compDef?._name}> beforeDestroy():`, e);
            }
        }

        if (componentInstance.$el?._spxSyncListeners) {
            componentInstance.$el._spxSyncListeners.forEach(l =>
                componentInstance.$el.removeEventListener(l.event, l.handler)
            );
            componentInstance.$el._spxSyncListeners = [];
        }

        this._cleanupEventListenersBoundWithin(compId);

        componentInstance._destroyed = true;

        if (componentInstance.$el) {
            const propsToClean = [
                '_spxIfPlaceholderNode', '_spxIfOriginalTemplateNode', '_spxIfWatchersAttached',
                '_spandrixComponent', '_spxRepeatAnchor', '_spx_event_listeners',
                '_spx_data_model_handler', '_spx_data_model_event_type', '_spx_static_class',
                '_spxLastFetchId', '_spxLastFetchCompletedSuccessfully', '_spxProcessedSignature',
                '_spx_node_is_fetching_this_request_id'
            ];
            propsToClean.forEach(prop => delete componentInstance.$el[prop]);
            componentInstance.$el.removeAttribute('data-spx-id');
            componentInstance.$el.innerHTML = '';
        }

        const nullifyProps = [
            '$el', '$props', '_componentData', '_watchers', '_computedWatchers',
            '_computedValuesCache', '$refs', '$slots', '_templateContext',
            '_parentDataContext', '_parentComponentInstance', '_parentLoopScope'
        ];
        nullifyProps.forEach(prop => componentInstance[prop] = null);

        if (compDef?.destroyed) {
            try {
                compDef.destroyed.call(contextToCall);
            } catch (e) {
                console.error(`Error in <${compDef?._name}> destroyed():`, e);
            }
        }
        this._callHook('afterComponentDestroy', contextToCall, componentInstance);
    }

    _addWatcher(componentInstance, path, callback) {
        if (!componentInstance || typeof callback !== 'function' || 
            typeof path !== 'string' || !path.trim()) {
            console.error('Spandrix $watch: Invalid arguments.');
            return () => {};
        }

        const resolveWatchedValue = () => {
            const context = componentInstance._templateContext;
            if (path.startsWith('$state.')) {
                return this._getValueByPath(this.$state, path.substring(7));
            }
            if (path.startsWith('globalData.')) {
                return this._getValueByPath(this.globalData, path.substring(11));
            }
            return this._getValueByPath(context, path);
        };

        const initialValue = resolveWatchedValue();
        const watcherRec = {
            path,
            callback,
            oldValue: this._deepClone(initialValue)
        };

        componentInstance._watchers.push(watcherRec);
        this._logDebug(
            `$watch: Added watcher for "${path}" on <${componentInstance._componentDef._name}>`
        );

        return () => {
            if (componentInstance._watchers) {
                componentInstance._watchers = componentInstance._watchers.filter(w => w !== watcherRec);
                this._logDebug(
                    `$watch: Removed watcher for "${path}" on <${componentInstance._componentDef._name}>`
                );
            }
        };
    }

    _camelCase(str) {
        return String(str)
            .replace(/[-_]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
            .replace(/^(.)/, c => c.toLowerCase());
    }

    _pascalCase(str) {
        const camel = this._camelCase(str);
        return camel.charAt(0).toUpperCase() + camel.slice(1);
    }

    _kebabCase(str) {
        return String(str)
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
    }

    convertToSpandrixSyntax(template) {
        if (typeof template !== 'string') return template;
        let processedTemplate = template;
        
        processedTemplate = processedTemplate.replace(
            /(?:\bv-on:([\w.-]+)=|@([\w.-]+)=)/g,
            (match, vOnEventName, atEventName) => `data-on:${vOnEventName || atEventName}=`
        );
        
        processedTemplate = processedTemplate.replace(
            /(?<![a-zA-Z0-9-_])(?:v-bind:|:)([\w.-]+)=/g,
            (match, attributeName) => `data-bind:${attributeName}=`
        );
        
        processedTemplate = processedTemplate.replace(/\bv-if=/g, 'data-if=');
        processedTemplate = processedTemplate.replace(/\bv-show=/g, 'data-show=');
        processedTemplate = processedTemplate.replace(
            /\bv-for="([^"]*)"/g,
            (match, expression) => `data-repeat="${expression}"`
        );
        processedTemplate = processedTemplate.replace(/\bv-model=/g, 'data-model=');
        
        return processedTemplate;
    }

    _updateComponentsUsingGlobalStateOrGlobalData() {
        this._logDebug('Checking components for global state/data changes.');
        
        document.querySelectorAll('[data-spx-id]').forEach(el => {
            const compInstance = el._spandrixComponent;
            if (compInstance && !compInstance._destroyed && compInstance._mounted) {
                let usesGlobal = false;
                const templateString = typeof compInstance._componentDef.template === 'function'
                    ? compInstance._componentDef.template.call(compInstance._templateContext)
                    : (compInstance._componentDef.template || '');
                
                if (templateString.includes('$state') || 
                    templateString.includes('globalData') ||
                    this._expressionUsesGlobal(
                        templateString,
                        compInstance._componentDef.computed,
                        this.globalData,
                        this.$state
                    )) {
                    usesGlobal = true;
                }

                if (usesGlobal) {
                    this._logDebug(
                        `Updating <${compInstance._componentDef._name}> ` +
                        `(${compInstance._componentId}) due to global change.`
                    );
                    compInstance.$update();
                }
            }
        });

        if (this.root && this._currentRootTemplateString &&
            (this._currentRootTemplateString.includes('$state') ||
             this._currentRootTemplateString.includes('globalData') ||
             this._expressionUsesGlobal(
                 this._currentRootTemplateString,
                 null,
                 this.globalData,
                 this.$state
             ))) {
            this._logDebug('Global change triggered root re-render.');
            this._scheduleRootReRender();
        }
    }

    _expressionUsesGlobal(template, computedProps, globalData, state) {
        const checkString = (str) => {
            if (str.includes('$state')) return true;
            if (str.includes('globalData')) return true;
            for (const key in globalData) {
                if (str.includes(key)) return true;
            }
            return false;
        };
        
        if (checkString(template)) return true;
        
        if (computedProps) {
            for (const key in computedProps) {
                if (checkString(computedProps[key].toString())) return true;
            }
        }
        return false;
    }

    _scheduleRootReRender() {
        if (this._rootRerenderScheduled) return;
        
        this._rootRerenderScheduled = true;
        Promise.resolve().then(() => {
            this._rootRerenderScheduled = false;
            this._reRenderRoot(this._currentRootTemplateString, this._currentRootData);
        }).catch(error => {
            console.error("Spandrix: Error in scheduled root re-render:", error);
            this._rootRerenderScheduled = false;
        });
    }

    _reRenderRoot(templateString, dataForRootProxy) {
        if (!this.root) {
            console.warn("Spandrix: Root element not set. Cannot re-render root.");
            return;
        }

        this._logPerformance('Root Re-render', () => {
            this._logDebug('Re-rendering root.');
            this._callHook('beforeRootRender', this, templateString, dataForRootProxy);

            Array.from(this.root.querySelectorAll('[data-spx-id]')).forEach(el => {
                if (el._spandrixComponent) {
                    this._destroyComponent(el._spandrixComponent);
                }
            });

            const processedRootTemplateString = this.convertToSpandrixSyntax(templateString);
            const tempContainer = document.createElement('div');
            tempContainer.innerHTML = processedRootTemplateString;

            const fragmentToAppend = document.createDocumentFragment();
            Array.from(tempContainer.childNodes).forEach(childNode => {
                const clonedChild = childNode.cloneNode(true);
                delete clonedChild._spxProcessedSignature;
                
                if (clonedChild.querySelectorAll) {
                    clonedChild.querySelectorAll('*').forEach(desc => {
                        delete desc._spxProcessedSignature;
                    });
                }
                
                const processedChild = this._processNode(
                    clonedChild,
                    dataForRootProxy,
                    null,
                    {},
                    fragmentToAppend
                );
                fragmentToAppend.appendChild(processedChild);
            });

            this.root.innerHTML = '';
            this.root.appendChild(fragmentToAppend);
            
            this._callHook('afterRootRender', this, templateString, dataForRootProxy);
            this._logDebug('Root re-render complete.');
            
            if (this.options.enablePerformanceMetrics) {
                this._performanceMetrics.renders++;
            }
        });
    }

    applyData(userData, templateString = null) {
        if (!this.root) {
            console.warn("Spandrix: Root element not set. Cannot applyData.");
            return;
        }

        const newRootData = (typeof userData === 'object' && userData !== null) 
            ? userData 
            : {};
        this._logDebug('Applying data to root:', { ...newRootData });

        this._currentRootData = this._makeReactive(
            newRootData,
            this._rootDataUpdateCallback,
            '_currentRootData_userProvided'
        );
        this._currentRootDataTarget = newRootData;

        this._currentRootTemplateString = templateString || 
            this.root.innerHTML || 
            this._originalRootTemplate;
        
        if (!this._currentRootTemplateString && this.root) {
            this._currentRootTemplateString = this._originalRootTemplate;
        }

        this._reRenderRoot(this._currentRootTemplateString, this._currentRootData);
    }

    _getCSRFToken() {
        const cookieName = this.options.csrfCookieName;
        const cookies = document.cookie.split(';');
        
        for (let cookie of cookies) {
            cookie = cookie.trim();
            if (cookie.startsWith(cookieName + '=')) {
                return cookie.substring(cookieName.length + 1);
            }
        }
        return null;
    }

    async request(url, options = {}) {
        this._logDebug('Request:', options.method || 'GET', url, options);
        let finalOptions = { ...options };

        for (const interceptor of this._requestInterceptors) {
            finalOptions = await interceptor(finalOptions, url) || finalOptions;
        }

        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes((finalOptions.method || 'GET').toUpperCase())) {
            const csrfToken = this._getCSRFToken();
            if (csrfToken) {
                finalOptions.headers = finalOptions.headers || {};
                finalOptions.headers[this.options.csrfHeaderName] = csrfToken;
            }
        }

        try {
            const response = await fetch(url, finalOptions);
            let data = response;

            for (const interceptor of this._responseInterceptors) {
                if (interceptor.success) {
                    data = await interceptor.success(data, url, finalOptions) || data;
                }
            }

            if (!response.ok) {
                const errorText = await (data.text ? data.text() : response.text());
                throw new Error(`HTTP error ${response.status}: ${errorText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return (data.json ? data.json() : response.json());
            }
            return (data.text ? data.text() : response.text());
        } catch (error) {
            let mutableError = error;
            
            for (const interceptor of this._responseInterceptors) {
                if (interceptor.error) {
                    mutableError = await interceptor.error(mutableError, url, finalOptions) || mutableError;
                }
            }
            
            console.error('Spandrix request error:', mutableError);
            throw mutableError;
        }
    }

    async loadJSON(url, options = {}) {
        return this.request(url, {
            method: 'GET',
            ...options,
            headers: {
                ...(options.headers || {}),
                'Accept': 'application/json'
            }
        });
    }

    async renderFrom(url, options = {}) {
        if (!this.root) {
            console.warn("Spandrix: Root element not set. Cannot renderFrom URL.");
            return Promise.reject(new Error("Root element not set"));
        }
        
        return this.loadJSON(url, options)
            .then(data => {
                this.applyData(data);
                return data;
            })
            .catch(err => {
                console.error(`Spandrix: Failed to render from URL "${url}".`, err);
                if (this.root) {
                    this.root.innerHTML = `<p style="color:red;">Error loading data from ${url}. Check console.</p>`;
                }
                throw err;
            });
    }

    addRequestInterceptor(fn) {
        if (typeof fn === 'function') {
            this._requestInterceptors.push(fn);
        }
    }

    addResponseInterceptor(successFn, errorFn = null) {
        if (typeof successFn === 'function' || typeof errorFn === 'function') {
            this._responseInterceptors.push({ success: successFn, error: errorFn });
        }
    }

    clearFetchCache(keyPrefix = null) {
        if (keyPrefix) {
            for (const key of this._fetchCache.keys()) {
                if (key.startsWith(keyPrefix)) {
                    this._fetchCache.delete(key);
                }
            }
        } else {
            this._fetchCache.clear();
        }
        this._logDebug('Fetch cache cleared' + (keyPrefix ? ` for prefix "${keyPrefix}"` : '.'));
    }

    use(plugin, options = {}) {
        if (plugin && typeof plugin.install === 'function') {
            try {
                plugin.install(this, options);
                this.plugins.push(plugin);
                this._logDebug('Plugin installed:', plugin.name || 'anonymous plugin object');
            } catch (e) {
                console.error('Spandrix: Error installing plugin object:', e);
            }
        } else if (typeof plugin === 'function') {
            try {
                plugin(this, options);
                this.plugins.push(plugin);
                this._logDebug('Functional plugin executed:', plugin.name || 'anonymous plugin function');
            } catch (e) {
                console.error('Spandrix: Error executing functional plugin:', e);
            }
        } else {
            console.error('Spandrix: Invalid plugin. Must be an object with install method or a function.');
        }
        return this;
    }
    
    _registerSystemComponents() {
        this.registerComponent('x-button', {
            template: `<button class="x-button" :type="type" :disabled="disabled" data-on:click="handleClick"><slot></slot></button>`,
            props: {
                type: { default: 'button' },
                disabled: { type: Boolean, default: false }
            },
            methods: {
                handleClick(event) {
                    if (!this.disabled) {
                        this.$emit('click', event);
                    }
                }
            }
        });

        this.registerComponent('x-modal', {
            template: `
                <div class="x-modal-overlay" data-if="isOpen" data-on:click="handleOverlayClick">
                    <div class="x-modal-content" data-on:click="stopPropagation">
                        <header class="x-modal-header" data-if="!hideHeader">
                            <slot name="header"><h2>{{ title }}</h2></slot>
                            <button class="x-modal-close" data-on:click="close" data-if="showCloseButton">&times;</button>
                        </header>
                        <section class="x-modal-body"><slot></slot></section>
                        <footer class="x-modal-footer" data-if="!hideFooter">
                            <slot name="footer"></slot>
                        </footer>
                    </div>
                </div>`,
            props: {
                isOpen: { type: Boolean, default: false },
                title: { default: 'Modal Title' },
                showCloseButton: { type: Boolean, default: true },
                closeOnClickOverlay: { type: Boolean, default: true },
                hideHeader: { type: Boolean, default: false },
                hideFooter: { type: Boolean, default: false }
            },
            model: { prop: 'isOpen', event: 'update:isOpen' },
            methods: {
                close() {
                    this.$emit('update:isOpen', false);
                    this.$emit('close');
                },
                handleOverlayClick(event) {
                    if (this.closeOnClickOverlay && event.target === event.currentTarget) {
                        this.close();
                    }
                },
                stopPropagation(event) {
                    event.stopPropagation();
                }
            },
            watch: {
                isOpen(newVal) {
                    if (newVal) this.$emit('open');
                }
            }
        });

        this.registerComponent('x-input', {
            template: `<input class="x-input" :type="type" :value="modelValue" :placeholder="placeholder" :disabled="disabled" :readonly="readonly" data-on:input="handleInput" data-on:change="handleChange" data-on:blur="handleBlur" data-on:focus="handleFocus" />`,
            props: {
                modelValue: { default: '' },
                type: { default: 'text' },
                placeholder: { default: '' },
                disabled: { type: Boolean, default: false },
                readonly: { type: Boolean, default: false }
            },
            model: { prop: 'modelValue', event: 'update:modelValue' },
            methods: {
                handleInput(event) {
                    this.$emit('update:modelValue', event.target.value);
                    this.$emit('input', event);
                },
                handleChange(event) {
                    this.$emit('change', event);
                },
                handleBlur(event) {
                    this.$emit('blur', event);
                },
                handleFocus(event) {
                    this.$emit('focus', event);
                }
            }
        });

        this.registerComponent('x-loading', {
            template: `
                <div class="x-loading" data-if="loading">
                    <div class="x-loading-spinner"></div>
                    <p data-if="message">{{ message }}</p>
                </div>`,
            props: {
                loading: { type: Boolean, default: true },
                message: { default: '' }
            }
        });

        this.registerComponent('x-alert', {
            template: `
                <div :class="alertClass" data-if="visible">
                    <span class="x-alert-icon" data-if="showIcon">{{ icon }}</span>
                    <div class="x-alert-content">
                        <strong data-if="title">{{ title }}</strong>
                        <slot></slot>
                    </div>
                    <button class="x-alert-close" data-on:click="close" data-if="closable">&times;</button>
                </div>`,
            props: {
                type: { default: 'info' },
                title: { default: '' },
                closable: { type: Boolean, default: true },
                showIcon: { type: Boolean, default: true }
            },
            data() {
                return {
                    visible: true
                };
            },
            computed: {
                alertClass() {
                    return `x-alert x-alert-${this.type}`;
                },
                icon() {
                    const icons = {
                        info: 'ℹ️',
                        success: '✅',
                        warning: '⚠️',
                        error: '❌'
                    };
                    return icons[this.type] || icons.info;
                }
            },
            methods: {
                close() {
                    this.visible = false;
                    this.$emit('close');
                }
            }
        });
    }

    getPerformanceMetrics() {
        return { ...this._performanceMetrics };
    }

    resetPerformanceMetrics() {
        this._performanceMetrics = { renders: 0, updates: 0, avgRenderTime: 0 };
    }

    destroy() {
        this._logDebug('Destroying SpandrixEngine instance.');
        document.querySelectorAll('[data-spx-id]').forEach(el => {
            if (el._spandrixComponent) {
                this._destroyComponent(el._spandrixComponent);
            }
        });
        this._cleanupAllEventListeners();
        this._fetchCache.clear();
        this._stateWatchers = [];
        if (this.root) {
            this.root.innerHTML = '';
        }
        this._logDebug('SpandrixEngine instance destroyed.');
    }
}

try {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = { SpandrixEngine };
    } else if (typeof define === 'function' && define.amd) {
        define('Spandrix', [], () => ({ SpandrixEngine }));
    } else {
        window.SpandrixEngine = SpandrixEngine;
    }
} catch (e) {
    console.error("Spandrix Engine: Could not determine export environment.", e);
    if (typeof window !== 'undefined') {
        window.SpandrixEngine = SpandrixEngine;
    }
}

export { SpandrixEngine };