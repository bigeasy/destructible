// Return the first not null-like value.
var coalesce = require('extant')

// Generate a unique, canonical string key from a JSON object.
var Keyify = require('keyify')

// Contextualized callbacks and event handlers.
var Operation = require('operation/variadic')

// Ever increasing serial integer with no maximum value.
var Monotonic = require('monotonic').asString

// Control-flow utilities.
var Signal = require('signal')
var cadence = require('cadence')
var abend = require('abend')

// Exceptions that you can catch by type.
var interrupt = require('interrupt').createInterrupter('destructible')

// Unique id for each instance of destructible.
var INSTANCE = '0'

// Construct a destructable that will track callbacks and timeout if they are
// not all invoked within a certain time frame when destroy is called.

//
function Destructible () {
    var vargs = Array.prototype.slice.call(arguments)

    // By default, we wait a full second for all outstanding callbacks to
    // return.
    var timeout = typeof vargs[0] == 'number' ? vargs.shift() : 1000

    // Displayed when we timeout.
    this.key = coalesce(vargs.shift())

    this.context = []
    this.addContext.apply(this, vargs)

    // Errors returned to callbacks.
    this.errors = []

    // Errors returned to calllbacks with contextual information.
    this.interrupts = []

    // True when all callbacks have completed or we've given up.
    this.destroyed = false

    // You're welcome to dump this list of waiting callbacks if it helps you
    // with debugging.
    this.waiting = []

    // Listen to know when we're done.
    this.completed = new Signal

    // Listen to know when to shut down.
    this.destruct = new Signal

    this._completed = new Signal

    this._notifications = []

    this._destructors = {}
    this.instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this._destructing = new Signal
    this._destroyedAt = null
    this._index = 0
    this._vargs = []

    this._done(timeout, abend)
}

Destructible.prototype._done = cadence(function (async, timeout) {
    async([function () {
        var vargs = [ null ]
        vargs = vargs.concat.apply(vargs, this._vargs)
        this.completed.unlatch.apply(this.completed, vargs)
    }], [function () {
        async(function () {
            this._destructing.wait(async())
        }, function () {
            timeout -= (Date.now() - this._destroyedAt)
            this._completed.wait(Math.max(timeout, 0), async())
        }, function () {
            if (this._completed.open == null) {
                throw new interrupt('hung', {
                    destructible: this.key,
                    waiting: this.waiting.slice(),
                    context: this.context
                }, {
                    cause: coalesce(this.errors[0])
                })
            }
        })
    }, function (error) {
        this.completed.unlatch(error)
    }])
})

Destructible.prototype._destroy = function (type, key, error) {
    if (error != null) {
        this.errors.push(error)
        this.interrupts.push(interrupt('error', { type: type, key: key }, error))
    }
    if (!this.destroyed && this._destroyedAt == null) {
        this._destroyedAt = Date.now()
        this._destructing.unlatch()
        try {
            this.destruct.notify()
        } catch (error) {
            this._destroy('destructor', null, error)
        }
        for (var key in this._destructors) {
            try {
                this._destructors[key].call()
            } catch (error) {
                this._destroy('destructor', Keyify.parse(key), error)
            }
            delete this._destructors[key]
        }
        this._complete()
        this.destroyed = true
    }
}

Destructible.prototype._complete = function () {
    // TODO Why not use `this.destroyed`?
    if (this.waiting.length == 0 && this._completed.open == null) {
        var vargs = this.errors.length ? [ this.errors[0] ] : []
        this._completed.unlatch.apply(this._completed, vargs)
    }
}

Destructible.prototype.destroy = function (error) {
    this._destroy('explicit', { module: 'destructible', method: 'destroy' }, coalesce(error))
}

Destructible.prototype.markDestroyed = function (object, property) {
    this.addDestructor('markDestroyed', function () {
        object[coalesce(property, 'destroyed')] = true
    })
}

Destructible.prototype.addContext = function () {
    this.context.push.apply(this.context, Array.prototype.slice.call(arguments))
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
    var destructor = this._destructors[key]
    if (destructor != null) {
        destructor()
        delete this._destructors[key]
        return true
    }
    return false
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

function Intializer (destructible, ready) {
    this._ready = ready
    this._destruct = new Signal
    destructible.destruct.wait(this._destruct, 'unlatch')
}

Intializer.prototype.destructor = function () {
    return this._destruct.wait.apply(this._destruct, Array.prototype.slice.call(arguments))
}

Intializer.prototype.cancel = function (cookie) {
    return this._destruct.cancel(cookie)
}

Intializer.prototype.ready = function () {
    this._ready.unlatch.apply(this._ready, Array.prototype.slice.call(arguments))
}

function errorify (ready, message) {
    return function (error) {
        if (error) {
            ready.unlatch(error)
        } else {
            ready.unlatch(interrupt(message))
        }
    }
}

Destructible.prototype._monitor = function (method, vargs) {
    var key = vargs.shift()
    if (vargs.length != 0) {
        var ready = new Signal(vargs.pop())
        if (this.destroyed) {
            this.completed.wait(errorify(ready, 'destroyed'))
        } else {
            var monitor = this.monitor(key)
            // We create a timer and clear the timeout when we are ready. The
            // timeout will be cleared by the `ready` signal when the user says
            // the stack is ready. If the stack crashes before it is ready, then
            // the `ready` signal will be unlatched by the `completed` signal.
            if (typeof vargs[0] == 'number') {
                var timeout = setTimeout(function () {
                    timeout = null
                    monitor(interrupt('timeout'))
                }, vargs.shift())
                ready.wait(function () {
                    if (timeout != null) {
                        clearTimeout(timeout)
                        timeout = null
                    }
                })
            }
            var f = Operation(vargs)
            var initializer = new Intializer(this, ready)
            this.completed.wait(errorify(ready, 'unready'))
            f.apply(null, vargs.concat(initializer, monitor))
        }
    } else {
        var wait = { module: 'destructible', method: 'monitor', key: key }
        this.waiting.push(wait)
        var index = this._index++
        return Operation([ this, function (error) {
            if (method == 'monitor') {
                this._vargs[index] = Array.prototype.slice.call(arguments, 1)
            }
            if (method == 'monitor' || error != null) {
                this._destroy('monitor', { module: 'destructible', method: method, key: key }, coalesce(error))
            }
            this.waiting.splice(this.waiting.indexOf(wait), 1)
            this._complete()
        } ])
    }
}

Destructible.prototype.monitor = function () {
    return this._monitor('monitor', Array.prototype.slice.call(arguments))
}

Destructible.prototype.rescue = function (key) {
    return this._monitor('rescue', Array.prototype.slice.call(arguments))
}

module.exports = Destructible
