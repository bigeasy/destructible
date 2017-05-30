// Return the first not null-like value.
var coalesce = require('extant')

// Generate a unique, canonical string key from a JSON object.
var Keyify = require('keyify')

// Contextualized callbacks and event handlers.
var Operation = require('operation/variadic')

// Event message queue.
var Procession = require('procession')

// Ever increasing serial integer with no maximum value.
var Monotonic = require('monotonic').asString

// Control-flow utilities.
var Signal = require('signal')
var cadence = require('cadence')

// Exceptions that you can catch by type.
var interrupt = require('interrupt').createInterrupter('destructible')

// Do nothing.
var nop = require('nop')

// Unique id for each instance of destructible.
var INSTANCE = '0'

// Uncatchable exception.
var panicIf = require('./panic').panicIf

function Destructible (key) {
    this.destroyed = false
    this.errors = []
    this.interrupts = []
    this.events = new Procession
    this.key = coalesce(key)
    this._destructors = {}
    this.waiting = []
    this.instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this.ready = new Signal
    this.ready.unlatch()
    this._destructing = new Signal
    this._completed = new Signal
}

Destructible.prototype._destroy = function (key, error) {
    if (error != null) {
        this.errors.push(error)
        this.interrupts.push(interrupt('error', { key: key }, error))
    }
    if (!this.destroyed) {
        this._destroyedAt = Date.now()
        this._destructing.unlatch()
        this._stackWhenDestroyed = new Error().stack
        this.events.push({
            module: 'destructible',
            method: 'destroyed',
            from: this.instance,
            body: {
                destructible: this.key,
                waiting: this.waiting.slice(),
                errors: this.errors.slice(),
                interrupts: this.interrupts.slice()
            }
        })
        this.destroyed = true
        for (var key in this._destructors) {
            this._destructors[key].call()
        }
        this._destructors = null
    }
    if (this.waiting.length == 0 && this._completed.open == null) {
        if (this.errors.length) {
            this._completed.unlatch(this.errors[0])
        } else {
            this._completed.unlatch()
        }
    }
}

Destructible.prototype.destroy = function () {
    this._destroy({ module: 'destructible', method: 'destroy' })
}

Destructible.prototype.markDestroyed = function (object, property) {
    this.addDestructor('markDestroyed', function () {
        object[coalesce(property, 'destroyed')] = true
    })
}

Destructible.prototype.addDestructor = function (key) {
    key = Keyify.stringify(key)
    var operation = Operation(Array.prototype.slice.call(arguments, 1))
    if (this.destroyed) {
        operation()
    } else {
        this._destructors[key] = operation
    }
}

Destructible.prototype.invokeDestructor = function (key) {
    key = Keyify.stringify(key)
    interrupt.assert(this._destructors != null, 'invokeDestroyed', this.errors[0], {
        stack: this._stackWhenDestroyed,
        when: this.when,
        destroyed: this.destroyed
    })
    var destructor = this._destructors[key]
    destructor()
    delete this._destructors[key]
}

Destructible.prototype.removeDestructor = function (key) {
    key = Keyify.stringify(key)
    delete this._destructors[key]
}

Destructible.prototype.getDestructors = function () {
    return Object.keys(this._destructors).map(function (key) {
        return Keyify.parse(key)
    })
}

Destructible.prototype._wait = function (method, key) {
    var wait = { module: 'destructible', method: method, key: key }
    this.waiting.push(wait)
    return wait
}

Destructible.prototype._unwait = function (wait, ready, method, key) {
    this.waiting.splice(this.waiting.indexOf(wait), 1)
    if (ready.open == null) {
        ready.unlatch()
    }
    if (method == 'monitor' || this.destroyed) {
        this._destroy({ module: 'destructible', method: method, key: key })
    }
    this.events.push({
        module: 'destructible',
        method: 'popped',
        from: this.instance,
        body: {
            destructible: this.key,
            destroyed: this.destroyed,
            method: method,
            key: key,
            waiting: this.waiting.slice(),
            errors: this.errors.slice(),
            interrupts: this.interrupts.slice()
        }
    })
}

function stack (destructible, async, method, key) {
    if (destructible.destroyed) {
        return function () {}
    }
    var previous = destructible.ready
    var ready = destructible.ready = new Signal
    return function () {
        var vargs = Array.prototype.slice.call(arguments)
        var wait = destructible._wait(method, key)
        async([function () {
            destructible._unwait(wait, ready, method, key)
        }], [function () {
            if (method == 'monitor') {
                vargs.unshift(function () { return [ ready ] })
            }
            async(function () {
                previous.wait(async())
            }, function () {
                if (!destructible.destroyed) {
                    async.apply(null, vargs)
                }
            })
        }, function (error) {
            destructible._destroy({ mdoule: 'destructible', method: method, key: key }, error)
            throw error
        }])
    }
}

Destructible.prototype._cadenced = cadence(function (async, method, key, operation, vargs, callback) {
    stack(this, async, method, key)(function () {
        operation.apply(this, Array.prototype.slice.call(arguments).concat(vargs).concat(async()))
    })

})

Destructible.prototype._stack = function (method, vargs) {
    if (typeof vargs[0] == 'function') {
        return stack(this, vargs[0], method, vargs[1])
    }
    if (vargs.length == 1) {
        var key = vargs[0], wait = this._wait('rescue', key)
        return Operation([ this, function (error) {
            if (method == 'monitor' || error != null) {
                this._destroy({ module: 'destructible', method: method, key: key }, error)
            }
            this._unwait(wait, new Signal(), 'rescue', key)
        } ])
    }
    var key = vargs.shift()
    var operation = Operation(vargs)
    var callback = typeof vargs[vargs.length - 1] == 'function' ? vargs.pop() : nop
    this._cadenced(method, key, operation, vargs, callback)
}

Destructible.prototype.monitor = function () {
    return this._stack('monitor', Array.prototype.slice.call(arguments))
}

Destructible.prototype.rescue = function () {
    return this._stack('rescue', Array.prototype.slice.call(arguments))
}

// Note that `ready` is an exposed signal while `completed` is a method that
// kind of looks like a signal. They are different because completed is not a
// signal. It is a double wait. It waits for the the start of destruction and
// then it sets a timer and waits for destruction to complete. Don't try to
// unify the interfaces, don't move to make them both signals or both methods.

//
Destructible.prototype._timeout = cadence(function (async, timeout) {
    async(function () {
        this._destructing.wait(async())
    }, function () {
        timeout -= (this._destroyedAt - Date.now())
        this._completed.wait(Math.max(timeout, 0), async())
    }, function () {
        panicIf(this._completed.open == null, 'hung', {
            destructible: this.key,
            waiting: this.waiting.slice(),
        }, { cause: coalesce(this.errors[0]) })
    })
})

Destructible.prototype.timeout = function (timeout, callback) {
    var vargs = Array.prototype.slice.call(arguments)
    timeout = typeof vargs[0] == 'number' ? vargs.shift() : 30000
    callback = typeof vargs[0] == 'function' ? vargs.shift() : nop
    this._timeout(timeout, callback)
}

module.exports = Destructible
