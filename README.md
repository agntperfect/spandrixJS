# ⚡ SpandrixEngine v2.0

> *A lightweight, reactive DOM templating engine inspired by the metaphysical principle of Spanda — the primordial pulse that brings structure to form.*

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/agntperfect/spandrixJS)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Size](https://img.shields.io/badge/size-~45KB-orange.svg)](dist/spandrix.min.js)

---

## 📋 Table of Contents

- [Philosophy](#-philosophy)
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Core Concepts](#-core-concepts)
- [API Reference](#-api-reference)
- [Directives](#-directives)
- [Components](#-components)
- [Filters](#-filters)
- [State Management](#-state-management)
- [HTTP & Data Fetching](#-http--data-fetching)
- [Lifecycle Hooks](#-lifecycle-hooks)
- [Advanced Usage](#-advanced-usage)
- [Examples](#-examples)
- [Browser Support](#-browser-support)
- [Performance](#-performance)

---

## 🧠 Philosophy

> The name **Spandrix** comes from:
> - 📟 **Spanda** (Sanskrit): "Subtle pulse" — the first creative vibration of consciousness
> - 🧩 **Matrix**: A structure from which things manifest

SpandrixEngine represents the metaphysical bridge between **awareness (data)** and **manifestation (DOM)**.

---

## 🌟 Features

### Core Features
- ✅ **Reactive Data Binding** – Automatic DOM updates when data changes
- ✅ **Component System** – Full-featured components with props, methods, computed, lifecycle
- ✅ **Template Directives** – `data-if`, `data-show`, `data-repeat`, `data-model`, `data-fetch`
- ✅ **Filter Pipeline** – Chainable custom filters (`| uppercase | truncate:50`)
- ✅ **Global State** – Centralized state management with watchers
- ✅ **Slot System** – Content projection with named slots
- ✅ **Event Handling** – Declarative event binding with arguments
- ✅ **Two-Way Binding** – v-model support for forms and components
- ✅ **HTTP Client** – Built-in request/response interceptors
- ✅ **Async Data Loading** – `data-fetch` directive for AJAX
- ✅ **Performance Metrics** – Built-in performance monitoring
- ✅ **Plugin System** – Extensible architecture
- ✅ **Zero Dependencies** – Pure vanilla JavaScript

### Security
- 🔒 HTML Sanitization by default
- 🔒 Expression validation (prevents code injection)
- 🔒 CSRF token support
- 🔒 Configurable raw HTML output

---

## 📦 Installation

### CDN (Recommended for quick start)

```html
<script src="https://cdn.jsdelivr.net/gh/agntperfect/spandrixJS/dist/spandrix.min.js"></script>
```

### NPM

```bash
npm install spandrix-engine
```

```javascript
import { SpandrixEngine } from 'spandrix-engine';
```

### Download

Download `spandrix.min.js` from the [releases page](https://github.com/agntperfect/spandrixJS/releases).

---

## 🚀 Quick Start

### Basic Example

```html
<!DOCTYPE html>
<html>
<head>
    <title>SpandrixEngine Demo</title>
</head>
<body>
    <div id="app">
        <h1>{{ title | uppercase }}</h1>
        <p>{{ message }}</p>
        <button data-on:click="greet">Say Hello</button>
    </div>

    <script src="spandrix.min.js"></script>
    <script>
        const engine = new SpandrixEngine('#app');
        
        engine.applyData({
            title: "Welcome to Spandrix",
            message: "A reactive templating engine",
            greet() {
                alert('Hello from Spandrix!');
            }
        });
    </script>
</body>
</html>
```

---

## 🎯 Core Concepts

### 1. Initialization

```javascript
const engine = new SpandrixEngine('#app', {
    debug: false,                    // Enable debug logging
    strictExpressions: false,        // Throw errors on expression failures
    allowRawHTML: false,             // Allow {{{ }}} raw HTML interpolation
    missingValuePlaceholder: '',     // Placeholder for undefined values
    enablePerformanceMetrics: false, // Track performance metrics
    maxRecursionDepth: 50,           // Prevent infinite recursion
    componentIdPrefix: 'spx-c-',     // Component ID prefix
    csrfCookieName: 'XSRF-TOKEN',    // CSRF cookie name
    csrfHeaderName: 'X-XSRF-TOKEN'   // CSRF header name
});
```

### 2. Data Binding

SpandrixEngine uses **reactive proxies** to automatically update the DOM when data changes.

```javascript
engine.applyData({
    count: 0,
    increment() {
        this.count++; // DOM updates automatically!
    }
});
```

### 3. Template Syntax

**Escaped Output** (HTML-safe):
```html
<p>{{ user.name }}</p>
```

**Raw Output** (requires `allowRawHTML: true`):
```html
<div>{{{ htmlContent }}}</div>
```

**With Filters**:
```html
<p>{{ price | currency:'$' }}</p>
<p>{{ description | truncate:100:'...' }}</p>
```

---

## 📖 API Reference

### Engine Methods

#### `applyData(data, template?)`
Renders the root template with the provided data.

```javascript
engine.applyData({
    title: "My App",
    users: [...]
});
```

#### `renderFrom(url, options?)`
Fetches JSON data from a URL and renders it.

```javascript
engine.renderFrom('/api/data')
    .then(data => console.log('Rendered:', data))
    .catch(err => console.error('Error:', err));
```

#### `setState(pathOrObject, value?)`
Updates global state.

```javascript
// Object syntax
engine.setState({ user: { name: 'Alice' }, count: 0 });

// Path syntax
engine.setState('user.name', 'Bob');
```

#### `watchState(path, callback)`
Watches for changes to global state.

```javascript
const unwatch = engine.watchState('user.name', (newVal, oldVal) => {
    console.log(`Name changed from ${oldVal} to ${newVal}`);
});

// Later: stop watching
unwatch();
```

#### `setGlobalData(data)`
Sets global data accessible to all components.

```javascript
engine.setGlobalData({
    apiUrl: 'https://api.example.com',
    theme: 'dark'
});
```

#### `registerComponent(name, definition)`
Registers a custom component.

```javascript
engine.registerComponent('user-card', {
    template: `<div class="card">{{ name }}</div>`,
    props: ['name'],
    data() { return { count: 0 }; },
    methods: { ... },
    computed: { ... },
    created() { ... },
    mounted() { ... }
});
```

#### `registerFilter(name, filterFn)`
Registers a custom filter.

```javascript
engine.registerFilter('reverse', (str) => {
    return String(str).split('').reverse().join('');
});
```

#### `registerDirective(name, handler)`
Registers a custom directive (advanced).

```javascript
engine.registerDirective('focus', (el, value, context) => {
    if (value) el.focus();
});
```

#### `use(plugin, options?)`
Installs a plugin.

```javascript
const myPlugin = {
    install(engine, options) {
        engine.registerFilter('myFilter', ...);
    }
};
engine.use(myPlugin, { option1: true });
```

#### `addHook(hookName, callback)`
Adds a lifecycle hook.

```javascript
engine.addHook('afterComponentMount', (context, instance) => {
    console.log('Component mounted:', instance._componentId);
});
```

#### `request(url, options?)`
Makes an HTTP request with interceptors.

```javascript
engine.request('/api/users', { method: 'POST', body: JSON.stringify(user) })
    .then(data => console.log(data));
```

#### `addRequestInterceptor(fn)`
Intercepts requests before they're sent.

```javascript
engine.addRequestInterceptor((options, url) => {
    options.headers = options.headers || {};
    options.headers['Authorization'] = 'Bearer ' + token;
    return options;
});
```

#### `addResponseInterceptor(successFn, errorFn)`
Intercepts responses.

```javascript
engine.addResponseInterceptor(
    (response) => {
        console.log('Response received:', response);
        return response;
    },
    (error) => {
        console.error('Request failed:', error);
        return error;
    }
);
```

#### `enableDebug()` / `disableDebug()`
Toggles debug logging.

```javascript
engine.enableDebug();
engine.disableDebug();
```

#### `config(options)`
Updates configuration (before locking).

```javascript
engine.config({ debug: true, allowRawHTML: true });
```

#### `lockConfig()`
Prevents further configuration changes.

```javascript
engine.lockConfig();
```

#### `getPerformanceMetrics()`
Returns performance data.

```javascript
const metrics = engine.getPerformanceMetrics();
console.log(metrics); // { renders: 10, updates: 5, avgRenderTime: 12.5 }
```

#### `destroy()`
Cleans up the engine and all components.

```javascript
engine.destroy();
```

---

## 🔧 Directives

### `data-if`
Conditionally renders an element.

```html
<div data-if="isVisible">This shows when isVisible is true</div>
<div data-if="!isHidden">This shows when isHidden is false</div>
```

### `data-show`
Toggles CSS `display` property.

```html
<div data-show="isActive">Toggles visibility without removing from DOM</div>
```

### `data-repeat`
Iterates over arrays or objects.

```html
<!-- Array iteration -->
<li data-repeat="item in items">{{ item.name }}</li>

<!-- With index -->
<li data-repeat="item, index in items">{{ index }}: {{ item.name }}</li>

<!-- Object iteration -->
<div data-repeat="value, key in user">{{ key }}: {{ value }}</div>

<!-- Object with index -->
<div data-repeat="value, key, index in items">
    {{ index }} - {{ key }}: {{ value }}
</div>
```

### `data-on:event`
Attaches event listeners.

```html
<!-- Simple handler -->
<button data-on:click="handleClick">Click Me</button>

<!-- With arguments -->
<button data-on:click="deleteItem(item.id, $event)">Delete</button>

<!-- Multiple events -->
<input data-on:focus="onFocus" data-on:blur="onBlur">
```

### `data-model`
Two-way data binding for form inputs.

```html
<!-- Text input -->
<input data-model="username" type="text">

<!-- Checkbox -->
<input data-model="agreed" type="checkbox">

<!-- Radio buttons -->
<input data-model="color" type="radio" value="red">
<input data-model="color" type="radio" value="blue">

<!-- Select dropdown -->
<select data-model="country">
    <option value="us">USA</option>
    <option value="uk">UK</option>
</select>

<!-- Textarea -->
<textarea data-model="message"></textarea>

<!-- Bind to $state -->
<input data-model="$state.searchQuery" type="text">

<!-- Bind to globalData -->
<input data-model="globalData.theme" type="text">
```

### `data-bind:attr` or `:attr`
Dynamic attribute binding.

```html
<!-- Bind attribute -->
<img :src="imageUrl" :alt="imageAlt">

<!-- Boolean attributes -->
<button :disabled="isLoading">Submit</button>

<!-- Class binding -->
<div :class="{ active: isActive, 'text-bold': isBold }">Text</div>
<div :class="['btn', 'btn-primary', { disabled: isDisabled }]">Button</div>
<div :class="dynamicClass">Dynamic</div>

<!-- Style binding -->
<div :style="{ color: textColor, fontSize: size + 'px' }">Styled</div>
<div :style="'color: red; font-size: 16px;'">Inline Style</div>
```

### `data-text`
Sets element's text content (safer than innerHTML).

```html
<p data-text="message"></p>
<!-- Filters work here too -->
<p data-text="description | truncate:50"></p>
```

### `data-html`
Sets element's HTML content (requires `allowRawHTML: true`).

```html
<div data-html="htmlContent"></div>
```

### `data-safe-html`
Sanitizes and sets HTML content (always safe).

```html
<div data-safe-html="userGeneratedContent"></div>
```

### `data-fetch`
Fetches data from a URL and binds it.

```html
<div data-fetch="/api/users" 
     data-fetch-as="users"
     data-fetch-method="GET"
     data-fetch-cache="true"
     data-fetch-loading-class="loading"
     data-fetch-error-class="error">
    
    <div data-if="users.$loading">Loading users...</div>
    <div data-if="users.$error">Error: {{ users.$error }}</div>
    
    <ul data-if="users.data">
        <li data-repeat="user in users.data">{{ user.name }}</li>
    </ul>
</div>
```

**Fetch state object:**
```javascript
{
    $loading: false,     // True while fetching
    $error: null,        // Error message if failed
    data: null,          // Fetched data
    _internal: { ... }   // Internal state
}
```

---

## 🧩 Components

### Basic Component

```javascript
engine.registerComponent('hello-world', {
    template: `
        <div class="hello">
            <h2>{{ greeting }}</h2>
            <p>{{ message }}</p>
        </div>
    `,
    data() {
        return {
            greeting: 'Hello',
            message: 'Welcome to Spandrix'
        };
    }
});
```

```html
<hello-world></hello-world>
```

### Component with Props

```javascript
engine.registerComponent('user-card', {
    template: `
        <div class="card">
            <h3>{{ name }}</h3>
            <p>{{ bio | default:'No bio available' }}</p>
            <p>Age: {{ age }}</p>
        </div>
    `,
    props: {
        name: { type: String, required: true },
        age: { type: Number, default: 0 },
        bio: { default: '' }
    }
});
```

```html
<user-card name="Alice" :age="30" :bio="userBio"></user-card>
```

### Component with Methods

```javascript
engine.registerComponent('counter', {
    template: `
        <div class="counter">
            <p>Count: {{ count }}</p>
            <button data-on:click="increment">+</button>
            <button data-on:click="decrement">-</button>
            <button data-on:click="reset">Reset</button>
        </div>
    `,
    data() {
        return { count: 0 };
    },
    methods: {
        increment() {
            this.count++;
        },
        decrement() {
            this.count--;
        },
        reset() {
            this.count = 0;
        }
    }
});
```

### Component with Computed Properties

```javascript
engine.registerComponent('price-calculator', {
    template: `
        <div>
            <input data-model="price" type="number" placeholder="Price">
            <input data-model="quantity" type="number" placeholder="Quantity">
            <p>Subtotal: {{ subtotal | currency }}</p>
            <p>Tax (10%): {{ tax | currency }}</p>
            <p>Total: {{ total | currency }}</p>
        </div>
    `,
    data() {
        return {
            price: 0,
            quantity: 0
        };
    },
    computed: {
        subtotal() {
            return this.price * this.quantity;
        },
        tax() {
            return this.subtotal * 0.1;
        },
        total() {
            return this.subtotal + this.tax;
        }
    }
});
```

### Component with Watchers

```javascript
engine.registerComponent('search-input', {
    template: `
        <div>
            <input data-model="query" placeholder="Search...">
            <p data-if="isSearching">Searching...</p>
        </div>
    `,
    data() {
        return {
            query: '',
            isSearching: false
        };
    },
    watch: {
        query(newVal, oldVal) {
            console.log(`Search query changed: ${oldVal} -> ${newVal}`);
            this.performSearch(newVal);
        }
    },
    methods: {
        performSearch(query) {
            this.isSearching = true;
            // Perform search...
            setTimeout(() => {
                this.isSearching = false;
            }, 1000);
        }
    }
});
```

### Component Lifecycle

```javascript
engine.registerComponent('lifecycle-demo', {
    template: `<div>{{ message }}</div>`,
    data() {
        return { message: 'Hello' };
    },
    created() {
        console.log('Component created');
        // Component instance created, data initialized
    },
    mounted() {
        console.log('Component mounted');
        // Component inserted into DOM
        // Can access this.$el
    },
    updated() {
        console.log('Component updated');
        // Called after re-render
    },
    beforeDestroy() {
        console.log('Component about to be destroyed');
        // Cleanup before component is removed
    },
    destroyed() {
        console.log('Component destroyed');
        // Component removed from DOM
    }
});
```

### Component with Slots

```javascript
engine.registerComponent('card-layout', {
    template: `
        <div class="card">
            <header class="card-header">
                <slot name="header"></slot>
            </header>
            <div class="card-body">
                <slot></slot>
            </div>
            <footer class="card-footer">
                <slot name="footer"></slot>
            </footer>
        </div>
    `
});
```

```html
<card-layout>
    <template slot="header">
        <h2>Card Title</h2>
    </template>
    
    <p>This is the main content</p>
    
    <template slot="footer">
        <button>Close</button>
    </template>
</card-layout>

<!-- Vue-like syntax also supported -->
<card-layout>
    <template #header>
        <h2>Card Title</h2>
    </template>
    
    <p>Default slot content</p>
    
    <template #footer>
        <button>Close</button>
    </template>
</card-layout>
```

### Component Events

```javascript
engine.registerComponent('custom-button', {
    template: `
        <button data-on:click="handleClick">
            <slot></slot>
        </button>
    `,
    methods: {
        handleClick(event) {
            this.$emit('clicked', { message: 'Button was clicked!' });
        }
    }
});
```

```html
<custom-button data-on:clicked="onButtonClicked">
    Click Me
</custom-button>

<script>
engine.applyData({
    onButtonClicked(data) {
        console.log(data.message);
    }
});
</script>
```

### Two-Way Binding on Components (v-model)

```javascript
engine.registerComponent('custom-input', {
    template: `
        <input :value="modelValue" 
               data-on:input="updateValue" 
               :placeholder="placeholder">
    `,
    props: {
        modelValue: { default: '' },
        placeholder: { default: '' }
    },
    model: {
        prop: 'modelValue',
        event: 'update:modelValue'
    },
    methods: {
        updateValue(event) {
            this.$emit('update:modelValue', event.target.value);
        }
    }
});
```

```html
<custom-input data-model="username"></custom-input>
<!-- or -->
<custom-input :model-value="username" 
              data-on:update:modelValue="username = $event">
</custom-input>
```

### .sync Modifier for Props

```javascript
engine.registerComponent('dialog', {
    template: `
        <div data-if="visible">
            <button data-on:click="close">Close</button>
            <slot></slot>
        </div>
    `,
    props: ['visible'],
    methods: {
        close() {
            this.$emit('update:visible', false);
        }
    }
});
```

```html
<dialog :visible.sync="isDialogOpen">
    Dialog content
</dialog>
```

### Component API Methods

Inside a component, you have access to:

```javascript
{
    // Properties
    this.$el,           // Host element
    this.$props,        // Component props
    this.$slots,        // Slot content
    this.$refs,         // Element references (future feature)
    this.$engine,       // Engine instance
    
    // Methods
    this.$emit(event, data),    // Emit custom event
    this.$update(),             // Force re-render
    this.$watch(path, callback),// Watch data changes
    this.$destroy(),            // Destroy component
    
    // Data & State
    this.dataProperty,          // Component data
    this.computedProperty,      // Computed properties
    this.method(),              // Component methods
    
    // Global access
    this.$state,                // Global state
    this.globalData             // Global data
}
```

---

## 🎨 Filters

### Built-in Filters

#### `uppercase`
```html
{{ text | uppercase }}
```

#### `lowercase`
```html
{{ text | lowercase }}
```

#### `capitalize`
```html
{{ text | capitalize }}
<!-- "hello world" -> "Hello world" -->
```

#### `truncate`
```html
{{ text | truncate:50 }}
{{ text | truncate:50:'...' }}
```

#### `currency`
```html
{{ price | currency }}
{{ price | currency:'€' }}
{{ price | currency:'$':2 }}
```

#### `date`
```html
{{ timestamp | date }}
{{ timestamp | date:'short' }}
{{ timestamp | date:'long' }}
{{ timestamp | date:'time' }}
```

#### `json`
```html
{{ object | json }}
{{ object | json:4 }}
```

#### `default`
```html
{{ value | default:'N/A' }}
```

### Custom Filters

```javascript
// Simple filter
engine.registerFilter('reverse', (str) => {
    return String(str).split('').reverse().join('');
});

// Filter with arguments
engine.registerFilter('repeat', (str, times) => {
    return String(str).repeat(times);
});

// Complex filter
engine.registerFilter('highlight', (text, searchTerm) => {
    if (!searchTerm) return text;
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    return String(text).replace(regex, '<mark>$1</mark>');
});
```

### Chaining Filters

```html
{{ description | truncate:100 | uppercase }}
{{ price | currency:'$' | default:'Free' }}
{{ user.bio | truncate:50:'...' | capitalize }}
```

---

## 🗄️ State Management

### Global State

```javascript
// Initialize state
engine.setState({
    user: null,
    isAuthenticated: false,
    cart: [],
    theme: 'light'
});

// Update state
engine.setState('user', { name: 'Alice', id: 1 });
engine.setState('cart', [...engine.$state.cart, newItem]);

// Watch state changes
const unwatch = engine.watchState('user', (newUser, oldUser) => {
    console.log('User changed:', newUser);
});

// Access in templates
// {{ $state.user.name }}
// <div data-if="$state.isAuthenticated">...</div>
```

### Global Data

```javascript
// Set global data (available to all components)
engine.setGlobalData({
    apiUrl: 'https://api.example.com',
    version: '2.0.0',
    features: ['reactive', 'components', 'filters']
});

// Access in templates
// {{ globalData.version }}
// {{ globalData.apiUrl }}

// Access in components
this.globalData.apiUrl
```

### Component-Level State

```javascript
engine.registerComponent('todo-list', {
    template: `...`,
    data() {
        return {
            todos: [],
            newTodo: ''
        };
    },
    methods: {
        addTodo() {
            this.todos.push({
                id: Date.now(),
                text: this.newTodo,
                done: false
            });
            this.newTodo = '';
        }
    }
});
```

---

## 🌐 HTTP & Data Fetching

### Basic Request

```javascript
// GET request
engine.request('/api/users')
    .then(users => console.log(users))
    .catch(err => console.error(err));

// POST request
engine.request('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alice' })
})
.then(response => console.log(response));
```

### Load JSON

```javascript
engine.loadJSON('/api/data')
    .then(data => console.log(data));
```

### Render from URL

```javascript
engine.renderFrom('/api/page-data')
    .then(data => console.log('Page rendered with:', data));
```

### Request Interceptors

```javascript
// Add auth token to all requests
engine.addRequestInterceptor((options, url) => {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${getToken()}`;
    return options;
});

// Log all requests
engine.addRequestInterceptor((options, url) => {
    console.log('Request:', options.method, url);
    return options;
});
```

### Response Interceptors

```javascript
// Handle errors globally
engine.addResponseInterceptor(
    // Success handler
    (response, url, options) => {
        console.log('Success:', url);
        return response;
    },
    // Error handler
    (error, url, options) => {
        if (error.message.includes('401')) {
            redirectToLogin();
        }
        return error;
    }
);
```

### Data Fetch Directive

```html
<div data-fetch="/api/posts" 
     data-fetch-as="posts"
     data-fetch-method="GET"
     data-fetch-cache="true">
    
    <!-- Loading state -->
    <div data-if="posts.$loading">
        <x-loading message="Loading posts..."></x-loading>
    </div>
    
    <!-- Error state -->
    <div data-if="posts.$error">
        <x-alert type="error" :title="posts.$error">
            Failed to load posts.
        </x-alert>
    </div>
    
    <!-- Success state -->
    <div data-if="posts.data">
        <article data-repeat="post in posts.data">
            <h2>{{ post.title }}</h2>
            <p>{{ post.excerpt | truncate:200 }}</p>
        </article>
    </div>
</div>
```

### CSRF Protection

SpandrixEngine automatically includes CSRF tokens in POST/PUT/PATCH/DELETE requests:

```javascript
// Token is read from cookie and added to header
const engine = new SpandrixEngine('#app', {
    csrfCookieName: 'XSRF-TOKEN',
    csrfHeaderName: 'X-XSRF-TOKEN'
});
```

---

## 🔄 Lifecycle Hooks

### Global Hooks

```javascript
engine.addHook('beforeComponentCreate', (context, instance) => {
    console.log('Creating component:', instance._componentId);
});

engine.addHook('afterComponentMount', (context, instance) => {
    console.log('Component mounted:', instance._componentId);
});

engine.addHook('beforeRootRender', (engine, template, data) => {
    console.log('About to render root');
});

engine.addHook('afterRootRender', (engine, template, data) => {
    console.log('Root render complete');
});
```

### Available Hooks

- `beforeComponentCreate`
- `afterComponentCreate`
- `beforeComponentMount`
- `afterComponentMount`
- `beforeComponentUpdate`
- `afterComponentUpdate`
- `beforeComponentDestroy`
- `afterComponentDestroy`
- `beforeRootRender`
- `afterRootRender`

### Component Lifecycle

```javascript
engine.registerComponent('example', {
    template: `<div>{{ message }}</div>`,
    data() {
        return { message: 'Hello' };
    },
    created() {
        // Data initialized, before DOM creation
        console.log('created');
    },
    mounted() {
        // Component in DOM, can access this.$el
        console.log('mounted');
    },
    updated() {
        // After re-render (data changed)
        console.log('updated');
    },
    beforeDestroy() {
        // Before component removal
        console.log('beforeDestroy');
    },
    destroyed() {
        // Component removed from DOM
        console.log('destroyed');
    }
});
```

---

## 🚀 Advanced Usage

### Plugin System

```javascript
const MyPlugin = {
    install(engine, options) {
        // Add custom filter
        engine.registerFilter('myFilter', (val) => {
            return val.toUpperCase();
        });
        
        // Add custom component
        engine.registerComponent('my-component', {
            template: '<div>Plugin Component</div>'
        });
        
        // Add global method
        engine.myMethod = function() {
            console.log('Custom method');
        };
        
        // Hook into lifecycle
        engine.addHook('afterComponentMount', (ctx, inst) => {
            console.log('Plugin: component mounted');
        });
    }
};

engine.use(MyPlugin, { option: 'value' });
```

### Performance Monitoring

```javascript
const engine = new SpandrixEngine('#app', {
    enablePerformanceMetrics: true
});

// Get metrics
const metrics = engine.getPerformanceMetrics();
console.log(metrics);
// { renders: 10, updates: 5, avgRenderTime: 12.5 }

// Reset metrics
engine.resetPerformanceMetrics();
```

### Custom Directives

```javascript
// Register custom directive
engine.registerDirective('focus', (element, value, dataContext, componentInstance) => {
    if (value) {
        element.focus();
    }
});
```

```html
<input data-focus="shouldFocus" type="text">
```

### Vue Syntax Compatibility

SpandrixEngine automatically converts Vue.js syntax:

```html
<!-- Vue syntax (converted automatically) -->
<div v-if="condition">Content</div>
<div v-show="visible">Content</div>
<div v-for="item in items">{{ item }}</div>
<button v-on:click="handler">Click</button>
<button @click="handler">Click</button>
<input v-bind:value="val">
<input :value="val">
<input v-model="data">

<!-- Becomes Spandrix syntax -->
<div data-if="condition">Content</div>
<div data-show="visible">Content</div>
<div data-repeat="item in items">{{ item }}</div>
<button data-on:click="handler">Click</button>
<button data-on:click="handler">Click</button>
<input data-bind:value="val">
<input data-bind:value="val">
<input data-model="data">
```

### Dynamic Templates

```javascript
engine.registerComponent('dynamic-template', {
    template() {
        // Template can be a function
        if (this.mode === 'list') {
            return `<ul><li data-repeat="item in items">{{ item }}</li></ul>`;
        } else {
            return `<div data-repeat="item in items">{{ item }}</div>`;
        }
    },
    props: ['mode', 'items']
});
```

### Nested Components

```javascript
engine.registerComponent('parent-component', {
    template: `
        <div class="parent">
            <h2>Parent</h2>
            <child-component :message="childMessage"></child-component>
        </div>
    `,
    data() {
        return {
            childMessage: 'Hello from parent'
        };
    }
});

engine.registerComponent('child-component', {
    template: `
        <div class="child">
            <p>{{ message }}</p>
        </div>
    `,
    props: ['message']
});
```

### Accessing Parent Component

```javascript
engine.registerComponent('nested', {
    template: `<div>{{ parentData }}</div>`,
    computed: {
        parentData() {
            // Access parent component instance (use with caution)
            return this._parentComponentInstance?.someData || 'No parent';
        }
    }
});
```

### Manual Component Updates

```javascript
engine.registerComponent('manual-update', {
    template: `<div>{{ time }}</div>`,
    data() {
        return { time: Date.now() };
    },
    mounted() {
        // Update every second
        this.timer = setInterval(() => {
            this.time = Date.now();
            // this.$update(); // Not needed, data change triggers update
        }, 1000);
    },
    beforeDestroy() {
        clearInterval(this.timer);
    }
});
```

### Watchers in Components

```javascript
engine.registerComponent('search-with-debounce', {
    template: `
        <div>
            <input data-model="query" placeholder="Search...">
            <p>{{ results.length }} results</p>
        </div>
    `,
    data() {
        return {
            query: '',
            results: []
        };
    },
    mounted() {
        // Watch with $watch
        this.$watch('query', (newVal, oldVal) => {
            this.debouncedSearch(newVal);
        });
    },
    methods: {
        debouncedSearch: debounce(function(query) {
            // Perform search
            fetch(`/api/search?q=${query}`)
                .then(r => r.json())
                .then(data => {
                    this.results = data;
                });
        }, 300)
    }
});
```

### Error Handling

```javascript
const engine = new SpandrixEngine('#app', {
    strictExpressions: true // Throw errors instead of silent fails
});

// Global error handling via hooks
engine.addHook('afterComponentCreate', (context, instance) => {
    try {
        // Your code
    } catch (error) {
        console.error('Component creation error:', error);
    }
});
```

### Memory Management

```javascript
// Cleanup when done
engine.destroy();

// Component-level cleanup
engine.registerComponent('cleanup-demo', {
    template: `<div>Component</div>`,
    mounted() {
        this.interval = setInterval(() => {
            console.log('Tick');
        }, 1000);
    },
    beforeDestroy() {
        // Clean up to prevent memory leaks
        clearInterval(this.interval);
        this.interval = null;
    }
});
```

---

## 💡 Examples

### Complete Todo App

```html
<!DOCTYPE html>
<html>
<head>
    <title>Todo App - SpandrixEngine</title>
    <style>
        .todo-app { max-width: 600px; margin: 50px auto; font-family: sans-serif; }
        .todo-item { padding: 10px; border-bottom: 1px solid #ddd; }
        .todo-item.done { text-decoration: line-through; opacity: 0.6; }
        .controls { margin: 20px 0; }
        .controls button { margin-right: 10px; }
    </style>
</head>
<body>
    <div id="app">
        <div class="todo-app">
            <h1>{{ title }}</h1>
            
            <div class="controls">
                <input data-model="newTodo" 
                       data-on:keyup.enter="addTodo"
                       placeholder="What needs to be done?">
                <button data-on:click="addTodo">Add</button>
            </div>
            
            <div class="filters">
                <button data-on:click="filter = 'all'" 
                        :class="{ active: filter === 'all' }">All</button>
                <button data-on:click="filter = 'active'"
                        :class="{ active: filter === 'active' }">Active</button>
                <button data-on:click="filter = 'done'"
                        :class="{ active: filter === 'done' }">Done</button>
            </div>
            
            <div class="todo-list">
                <div class="todo-item" 
                     data-repeat="todo in filteredTodos"
                     :class="{ done: todo.done }">
                    <input type="checkbox" 
                           data-model="todo.done"
                           data-on:change="saveTodos">
                    <span>{{ todo.text }}</span>
                    <button data-on:click="removeTodo(todo.id)">Delete</button>
                </div>
            </div>
            
            <p>{{ stats }}</p>
        </div>
    </div>

    <script src="spandrix.min.js"></script>
    <script>
        const engine = new SpandrixEngine('#app', { debug: true });
        
        engine.applyData({
            title: 'My Todo List',
            newTodo: '',
            filter: 'all',
            todos: JSON.parse(localStorage.getItem('todos') || '[]'),
            
            computed: {
                filteredTodos() {
                    if (this.filter === 'active') {
                        return this.todos.filter(t => !t.done);
                    } else if (this.filter === 'done') {
                        return this.todos.filter(t => t.done);
                    }
                    return this.todos;
                },
                stats() {
                    const total = this.todos.length;
                    const done = this.todos.filter(t => t.done).length;
                    return `${done} / ${total} completed`;
                }
            },
            
            addTodo() {
                if (!this.newTodo.trim()) return;
                this.todos.push({
                    id: Date.now(),
                    text: this.newTodo,
                    done: false
                });
                this.newTodo = '';
                this.saveTodos();
            },
            
            removeTodo(id) {
                this.todos = this.todos.filter(t => t.id !== id);
                this.saveTodos();
            },
            
            saveTodos() {
                localStorage.setItem('todos', JSON.stringify(this.todos));
            }
        });
    </script>
</body>
</html>
```

### User Dashboard

```html
<div id="app">
    <div class="dashboard">
        <header>
            <h1>Dashboard</h1>
            <div data-if="$state.user">
                Welcome, {{ $state.user.name }}!
                <button data-on:click="logout">Logout</button>
            </div>
        </header>
        
        <!-- Fetch users from API -->
        <div data-fetch="/api/users" 
             data-fetch-as="users"
             data-fetch-loading-class="loading">
            
            <x-loading data-if="users.$loading" 
                       message="Loading users..."></x-loading>
            
            <x-alert data-if="users.$error" 
                     type="error" 
                     :title="users.$error"></x-alert>
            
            <div data-if="users.data" class="user-grid">
                <user-card data-repeat="user in users.data"
                          :name="user.name"
                          :email="user.email"
                          :avatar="user.avatar"
                          data-on:view="viewUser(user)">
                </user-card>
            </div>
        </div>
    </div>
</div>

<script>
const engine = new SpandrixEngine('#app');

// Set initial state
engine.setState({
    user: { name: 'Alice', id: 1 },
    selectedUser: null
});

// Register user card component
engine.registerComponent('user-card', {
    template: `
        <div class="card">
            <img :src="avatar" :alt="name">
            <h3>{{ name }}</h3>
            <p>{{ email }}</p>
            <button data-on:click="$emit('view')">View Profile</button>
        </div>
    `,
    props: ['name', 'email', 'avatar']
});

engine.applyData({
    viewUser(user) {
        engine.setState('selectedUser', user);
        console.log('Viewing:', user);
    },
    logout() {
        engine.setState('user', null);
        // Redirect to login
    }
});
</script>
```

### Form Validation

```html
<div id="app">
    <form-validator>
        <h2>Sign Up</h2>
        
        <div class="field">
            <label>Username</label>
            <input data-model="username" data-on:blur="validateUsername">
            <span class="error" data-if="errors.username">
                {{ errors.username }}
            </span>
        </div>
        
        <div class="field">
            <label>Email</label>
            <input data-model="email" type="email" data-on:blur="validateEmail">
            <span class="error" data-if="errors.email">
                {{ errors.email }}
            </span>
        </div>
        
        <div class="field">
            <label>Password</label>
            <input data-model="password" type="password" data-on:blur="validatePassword">
            <span class="error" data-if="errors.password">
                {{ errors.password }}
            </span>
        </div>
        
        <button data-on:click="submit" :disabled="!isValid">
            Submit
        </button>
    </form-validator>
</div>

<script>
const engine = new SpandrixEngine('#app');

engine.registerComponent('form-validator', {
    template: `<div class="form"><slot></slot></div>`,
    data() {
        return {
            username: '',
            email: '',
            password: '',
            errors: {}
        };
    },
    computed: {
        isValid() {
            return this.username && this.email && this.password &&
                   Object.keys(this.errors).length === 0;
        }
    },
    methods: {
        validateUsername() {
            if (!this.username) {
                this.errors.username = 'Username is required';
            } else if (this.username.length < 3) {
                this.errors.username = 'Username must be at least 3 characters';
            } else {
                delete this.errors.username;
            }
        },
        validateEmail() {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!this.email) {
                this.errors.email = 'Email is required';
            } else if (!emailRegex.test(this.email)) {
                this.errors.email = 'Invalid email format';
            } else {
                delete this.errors.email;
            }
        },
        validatePassword() {
            if (!this.password) {
                this.errors.password = 'Password is required';
            } else if (this.password.length < 8) {
                this.errors.password = 'Password must be at least 8 characters';
            } else {
                delete this.errors.password;
            }
        },
        submit() {
            this.validateUsername();
            this.validateEmail();
            this.validatePassword();
            
            if (this.isValid) {
                console.log('Form submitted:', {
                    username: this.username,
                    email: this.email,
                    password: this.password
                });
            }
        }
    }
});
</script>
```

### Real-time Search

```html
<div id="app">
    <search-box></search-box>
</div>

<script>
const engine = new SpandrixEngine('#app');

engine.registerComponent('search-box', {
    template: `
        <div class="search">
            <input data-model="query" 
                   placeholder="Search products..."
                   data-on:input="onSearch">
            
            <x-loading data-if="isSearching" 
                       message="Searching..."></x-loading>
            
            <div class="results" data-if="results.length && !isSearching">
                <div class="result" data-repeat="result in results">
                    <h4>{{ result.name }}</h4>
                    <p>{{ result.description | truncate:100 }}</p>
                    <span class="price">{{ result.price | currency }}</span>
                </div>
            </div>
            
            <p data-if="!results.length && !isSearching && query">
                No results found for "{{ query }}"
            </p>
        </div>
    `,
    data() {
        return {
            query: '',
            results: [],
            isSearching: false,
            debounceTimer: null
        };
    },
    methods: {
        onSearch() {
            clearTimeout(this.debounceTimer);
            
            if (!this.query.trim()) {
                this.results = [];
                return;
            }
            
            this.debounceTimer = setTimeout(() => {
                this.performSearch();
            }, 300);
        },
        async performSearch() {
            this.isSearching = true;
            
            try {
                const response = await fetch(`/api/search?q=${this.query}`);
                this.results = await response.json();
            } catch (error) {
                console.error('Search error:', error);
                this.results = [];
            } finally {
                this.isSearching = false;
            }
        }
    },
    beforeDestroy() {
        clearTimeout(this.debounceTimer);
    }
});
</script>
```

### Modal Dialog System

```html
<div id="app">
    <button data-on:click="openModal">Open Modal</button>
    
    <x-modal data-model="isModalOpen" 
             title="Confirmation"
             :close-on-click-overlay="true">
        
        <p>Are you sure you want to proceed?</p>
        
        <template slot="footer">
            <button data-on:click="confirm">Confirm</button>
            <button data-on:click="isModalOpen = false">Cancel</button>
        </template>
    </x-modal>
</div>

<script>
const engine = new SpandrixEngine('#app');

engine.applyData({
    isModalOpen: false,
    openModal() {
        this.isModalOpen = true;
    },
    confirm() {
        console.log('Confirmed!');
        this.isModalOpen = false;
    }
});
</script>
```

---

## 🌍 Browser Support

| Browser | Version |
|---------|---------|
| Chrome | ≥ 60 |
| Firefox | ≥ 60 |
| Safari | ≥ 12 |
| Edge | ≥ 79 |
| Opera | ≥ 47 |

**Required Features:**
- ES6 Proxy
- ES6 Classes
- Promises
- Fetch API (or polyfill)

---

## ⚡ Performance

### Optimization Tips

1. **Use `data-show` instead of `data-if` when toggling frequently**
   ```html
   <!-- Better for frequent toggles -->
   <div data-show="isVisible">Content</div>
   
   <!-- Better for conditional rendering -->
   <div data-if="isVisible">Content</div>
   ```

2. **Avoid deep nesting in data-repeat**
   ```html
   <!-- Less optimal -->
   <div data-repeat="cat in categories">
       <div data-repeat="item in cat.items">
           <div data-repeat="variant in item.variants">
               ...
           </div>
       </div>
   </div>
   
   <!-- Better: flatten data structure -->
   <div data-repeat="item in flattenedItems">...</div>
   ```

3. **Use computed properties for expensive operations**
   ```javascript
   computed: {
       expensiveValue() {
           // Only recalculated when dependencies change
           return this.items.filter(...).map(...).reduce(...);
       }
   }
   ```

4. **Debounce user input handlers**
   ```javascript
   methods: {
       onInput: debounce(function(event) {
           this.search(event.target.value);
       }, 300)
   }
   ```

5. **Enable performance metrics in development**
   ```javascript
   const engine = new SpandrixEngine('#app', {
       enablePerformanceMetrics: true,
       debug: true
   });
   ```

6. **Clean up in lifecycle hooks**
   ```javascript
   mounted() {
       this.timer = setInterval(() => {...}, 1000);
   },
   beforeDestroy() {
       clearInterval(this.timer); // Prevent memory leaks
   }
   ```

### Benchmarks

| Operation | Time (avg) |
|-----------|-----------|
| Initial render (1000 items) | ~15ms |
| Update single item | ~2ms |
| Re-render component | ~5ms |
| Filter 1000 items | ~3ms |
| Component mount | ~1ms |

*Tested on Chrome 120, Intel i7, 16GB RAM*

---

## 🔒 Security

### XSS Protection

By default, SpandrixEngine sanitizes all output:

```html
<!-- Safe: automatically escaped -->
<p>{{ userInput }}</p>

<!-- Unsafe: requires allowRawHTML: true -->
<div>{{{ htmlContent }}}</div>

<!-- Always safe: sanitized even if raw -->
<div data-safe-html="userContent"></div>
```

### Expression Validation

```javascript
const engine = new SpandrixEngine('#app', {
    warnOnUnsafeEval: true // Default: true
});

// These are blocked:
// {{ eval('malicious code') }}
// {{ Function('return malicious')() }}
// {{ setTimeout('malicious', 0) }}
```

### CSRF Protection

```javascript
// Automatically adds CSRF token to mutations
const engine = new SpandrixEngine('#app', {
    csrfCookieName: 'XSRF-TOKEN',
    csrfHeaderName: 'X-XSRF-TOKEN'
});
```

### Content Security Policy

SpandrixEngine is CSP-friendly when `strictExpressions: false` (default):

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self'">
```

---

## 🐛 Troubleshooting

### Common Issues

**1. "Expression not updating"**
```javascript
// ❌ Wrong: Modifying non-reactive object
const data = { count: 0 };
engine.applyData(data);
data.count++; // Won't trigger update

// ✅ Correct: Use reactive proxy
engine.applyData({ count: 0 });
engine._currentRootData.count++; // Triggers update
```

**2. "Component not re-rendering"**
```javascript
// ❌ Wrong: Adding property after initialization
data() {
    return { items: [] };
},
methods: {
    addProp() {
        this.newProp = 'value'; // Not reactive!
    }
}

// ✅ Correct: Define all properties upfront
data() {
    return {
        items: [],
        newProp: null // Will be reactive
    };
}
```

**3. "Filter not found"**
```javascript
// Make sure filter is registered before use
engine.registerFilter('myFilter', (val) => val);
engine.applyData({...}); // Now can use {{ value | myFilter }}
```

**4. "Memory leak"**
```javascript
// ❌ Wrong: Not cleaning up
mounted() {
    this.timer = setInterval(() => {...}, 1000);
}

// ✅ Correct: Clean up
beforeDestroy() {
    clearInterval(this.timer);
}
```

**5. "data-fetch not working"**
```html
<!-- Make sure you're checking the right properties -->
<div data-fetch="/api/data" data-fetch-as="myData">
    <!-- ❌ Wrong -->
    <div data-if="myData">{{ myData }}</div>
    
    <!-- ✅ Correct -->
    <div data-if="myData.data">{{ myData.data }}</div>
</div>
```

### Debug Mode

```javascript
const engine = new SpandrixEngine('#app', { debug: true });
// Logs all reactive changes, renders, and lifecycle events
```

---

## 📚 Migration from Other Frameworks

### From Vue.js

SpandrixEngine is inspired by Vue and shares similar syntax:

```javascript
// Vue
new Vue({
    el: '#app',
    data: { count: 0 },
    methods: { increment() { this.count++; } }
});

// Spandrix
const engine = new SpandrixEngine('#app');
engine.applyData({
    count: 0,
    increment() { this.count++; }
});
```

**Differences:**
- No virtual DOM (direct DOM manipulation)
- Smaller bundle size
- Simpler API
- No single-file components (.vue)

### From React

```javascript
// React
function Counter() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
}

// Spandrix
engine.registerComponent('counter', {
    template: '<button data-on:click="increment">{{ count }}</button>',
    data() { return { count: 0 }; },
    methods: { increment() { this.count++; } }
});
```

### From jQuery

```javascript
// jQuery
$('#button').click(function() {
    var count = parseInt($('#count').text()) + 1;
    $('#count').text(count);
});

// Spandrix
engine.applyData({
    count: 0,
    increment() { this.count++; }
});
// Template: <button data-on:click="increment">{{ count }}</button>
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
git clone https://github.com/agntperfect/spandrixJS.git
cd spandrixJS
npm install
npm run dev
```

### Running Tests

```bash
npm test
```

### Building

```bash
npm run build
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.


---

## 🗺️ Roadmap

### v2.1 (Planned)
- [ ] TypeScript definitions
- [ ] Dev tools browser extension
- [ ] SSR (Server-Side Rendering)
- [ ] Virtual scrolling component
- [ ] Animation system

### v2.2 (Future)
- [ ] Time-travel debugging
- [ ] Component lazy loading
- [ ] i18n plugin
- [ ] Form validation plugin
- [ ] State persistence plugin

---

## 📊 Stats

- **Size**: ~45KB minified (~12KB gzipped)
- **Dependencies**: 0
- **Bundle**: UMD, ESM, CommonJS
- **License**: MIT
- **First Release**: 2025
- **Current Version**: 2.0.0

---

<div align="center">

**Built with passion. Driven by philosophy. Rendered with purpose.**

</div>