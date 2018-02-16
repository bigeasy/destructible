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
            this.destruct.unlatch()
        } catch (error) {
            this._destroy('destructor', null, error)
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
    return this.destruct.wait(function () {
        object[coalesce(property, 'destroyed')] = true
    })
}

Destructible.prototype.addContext = function () {
    this.context.push.apply(this.context, Array.prototype.slice.call(arguments))
}

Destructible.prototype.destructible = function () {
    var vargs = Array.prototype.slice.call(arguments)
    var key = vargs[0]
    var destructible = new Destructible(key)
    var cookie = this.destruct.wait(destructible, 'destroy')
    destructible.destruct.wait(this, function () { this.destruct.cancel(cookie) })
    destructible.completed.wait(this.monitor.apply(this, vargs))
    return destructible
}

function Intializer (destructible, ready) {
    this._ready = ready
    this._destructible = destructible
}

Intializer.prototype.destructible = function () {
    if (this._childDestructible == null) {
        this._childDestructible = this._destructible.destructible(this._key)
    }
    return this._childDestructible
}

Intializer.prototype.destructor = function () {
    return this._destructible.destruct.wait.apply(this._destructible.destruct, Array.prototype.slice.call(arguments))
}

Intializer.prototype.cancel = function (cookie) {
    return this._destructible.destruct.cancel(cookie)
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

Destructible.prototype.monitor = function () {
    var vargs = Array.prototype.slice.call(arguments)
    var key = vargs.shift()
    var terminates = false
    if (typeof vargs[0] == 'boolean') {
        terminates = vargs.shift()
    }
    if (vargs.length != 0) {
        var ready = new Signal(vargs.pop())
        if (this.destroyed) {
            this.completed.wait(errorify(ready, 'destroyed'))
        } else {
            var monitor = this.monitor(key, terminates)
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
        var wait = { module: 'destructible', method: 'monitor', terminates: terminates, key: key }
        this.waiting.push(wait)
        var index = this._index++
        return Operation([ this, function (error) {
            if (! terminates) {
                this._vargs[index] = Array.prototype.slice.call(arguments, 1)
            }
            if (! terminates || error != null) {
                this._destroy('monitor', { module: 'destructible', method: 'monitor', terminates: terminates, key: key }, coalesce(error))
            }
            this.waiting.splice(this.waiting.indexOf(wait), 1)
            this._complete()
        } ])
    }
}

module.exports = Destructible
