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

Destructible.prototype._destroy = function (context, error) {
    if (error != null) {
        this.errors.push(error)
        this.interrupts.push(interrupt('error', context, error))
    }
    if (this._destroyedAt == null) {
        this._destroyedAt = Date.now()
        this._destructing.unlatch()
        try {
            this.destruct.unlatch()
        } catch (error) {
            this._destroy({ module: 'destructible', method: 'destructing' }, error)
        }
        this._complete()
        this.destroyed = true
    }
}

Destructible.prototype._complete = function () {
    // TODO Why not use `this.destroyed`?
    if (this._destroyedAt != null && this.waiting.length == 0 && this._completed.open == null) {
        var vargs = this.errors.length ? [ this.errors[0] ] : []
        this._completed.unlatch.apply(this._completed, vargs)
    }
}

Destructible.prototype.destroy = function (error) {
    this._destroy({ module: 'destructible', method: 'destroy' }, coalesce(error))
}

Destructible.prototype.markDestroyed = function (object, property) {
    return this.destruct.wait(function () {
        object[coalesce(property, 'destroyed')] = true
    })
}

Destructible.prototype.addContext = function () {
    this.context.push.apply(this.context, Array.prototype.slice.call(arguments))
}

Destructible.prototype.destructible = function (terminates) {
    var vargs = Array.prototype.slice.call(arguments)
    var key = vargs[0]
    var destructible = new Destructible(key)
    var cookie = this.destruct.wait(destructible, 'destroy')
    destructible.destruct.wait(this, function () { this.destruct.cancel(cookie) })
    destructible.completed.wait(this._monitor('destructible', [ key, !! terminates ]))
    return destructible
}

function errorify (callback, message) {
    return function (error) {
        if (error) {
            callback(error)
        } else {
            callback(interrupt(message))
        }
    }
}

Destructible.prototype._fork = cadence(function (async, key, terminates, vargs, callback) {
    var destructible = new Destructible(key)
    var destroy = this.destruct.wait(destructible, 'destroy')
    destructible.destruct.wait(this, function () { this.destruct.cancel(destroy) })
    var monitor = this._monitor('destructible', [ key, !! terminates ])
    destructible.completed.wait(function () {
        monitor.apply(null, Array.prototype.slice.call(arguments))
    })
    var timeout = null
    // We create a timer and clear the timeout when we are ready. The
    // timeout will be cleared by the `ready` signal when the user says
    // the stack is ready. If the stack crashes before it is ready, then
    // the `ready` signal will be unlatched by the `completed` signal.
    if (typeof vargs[0] == 'number') {
        timeout = setTimeout(function () {
            timeout = null
            var e = interrupt('timeout')
            destructible.destroy(e)
            callback(e)
        }, vargs.shift())
    }
    var unready = this.completed.wait(function () {
        unready = null
        destructible.destroy(interrupt('unready'))
    })
    async([function () {
        if (timeout != null) {
            clearTimeout(timeout)
        }
        if (unready != null) {
            this.completed.cancel(unready)
        }
    }], [function () {
        var f = Operation(vargs)
        vargs.push(async())
        vargs.unshift(destructible)
        f.apply(null, vargs)
    }, function (error) {
        destructible.destroy(error)
        throw error
    }])
})

Destructible.prototype._monitor = function (method, vargs) {
    var key = vargs.shift()
    var terminates = false
    if (typeof vargs[0] == 'boolean') {
        terminates = vargs.shift()
    }
    if (vargs.length != 0) {
        var callback = vargs.pop()
        if (this.destroyed) {
            this.completed.wait(errorify(callback, 'destroyed'))
        } else {
            this._fork(key, terminates, vargs, callback, callback)
        }
    } else {
        var wait = { module: 'destructible', method: method, terminates: terminates, key: key }
        this.waiting.push(wait)
        var index = this._index++
        return Operation([ this, function (error) {
            if (! terminates) {
                this._vargs[index] = Array.prototype.slice.call(arguments, 1)
            }
            if (! terminates || error != null) {
                this._destroy({ module: 'destructible', method: method, terminates: terminates, key: key }, coalesce(error))
            }
            this.waiting.splice(this.waiting.indexOf(wait), 1)
            this._complete()
        } ])
    }
}

Destructible.prototype.monitor = function () {
    return this._monitor('monitor', Array.prototype.slice.call(arguments))
}

Destructible.prototype.subordinate = cadence(function (async, destructible) {
    this.completed.wait(destructible.monitor('completed'))
    destructible.destruct.wait(this, 'destroy')
})

module.exports = Destructible
