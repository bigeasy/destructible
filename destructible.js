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
    this._errors = []

    // True when all callbacks have completed or we've given up.
    this.destroyed = false

    // You're welcome to dump this list of waiting callbacks if it helps you
    // with debugging.
    this.waiting = []

    // Listen to know when we're done.
    this.completed = new Signal

    // Listen to know when to shut down.
    this.destruct = new Signal

    // Listen to know if we've forcibly shutdown before all callbacks have
    // returned.
    this.scrammed = new Signal

    this._completed = new Signal

    this._notifications = []

    this.instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this._destructing = new Signal
    this._destroyedAt = null
    this._index = 0
    this._vargs = []

    this._errored = function () {}

    this._done(timeout, abend)
}

Destructible.prototype._done = cadence(function (async, timeout) {
    var timer
    async(function () {
        this._destructing.wait(async())
    }, function () {
        timer = setTimeout(function () {
            timer = null
            this.scram()
        }.bind(this), timeout - Math.max(Date.now() - this._destroyedAt, 0))
        this._completed.wait(async())
    }, function (scrammed) {
        if (timer != null) {
            clearTimeout(timer)
        }
        if (scrammed) {
            this.completed.unlatch(interrupt('hung', this._errors.slice(), {
                destructible: this.key,
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else if (this._errors.length) {
            this.completed.unlatch(interrupt('error', this._errors.slice(), {
                module: 'destructible',
                key: this.key,
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else {
            var vargs = [ null ]
            vargs = vargs.concat.apply(vargs, this._vargs)
            this.completed.unlatch.apply(this.completed, vargs)
        }
    })
})

Destructible.prototype._destroy = function (context, error) {
    if (error != null) {
        this._errors.push(error)
        this._errored.call()
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
        this._completed.unlatch(null, false)
    }
}

Destructible.prototype.destroy = function (error) {
    this._destroy({ module: 'destructible', method: 'destroy' }, coalesce(error))
}

Destructible.prototype.scram = function (error) {
    if (this._completed.open == null) {
        this._destroy({ module: 'destructible', method: 'scram' }, coalesce(error))
        this.scrammed.notify()
        this._completed.notify(null, true)
    }
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

function errorify (callback, message, context) {
    return function (error) {
        callback(interrupt(message, error, context))
    }
}

Destructible.prototype._fork = cadence(function (async, key, terminates, vargs, callback) {
    var destructible = new Destructible(key)
    var destroy = this.destruct.wait(destructible, 'destroy')
    var scram = this.scrammed.wait(destructible, 'scram')
    if (terminates) {
        destructible._errored = function () {
            this.destruct.cancel(destroy)
            this.destroy()
        }.bind(this)
    } else {
        destructible.destruct.wait(this, function () { this.destruct.cancel(destroy) })
        destructible.destruct.wait(this, 'destroy')
    }
    var monitor = this._monitor('destructible', [ key, !! terminates ])
    destructible.completed.wait(this, function (error) {
        this.scrammed.cancel(scram)
        monitor.apply(null, Array.prototype.slice.call(arguments))
        if (error != null || ! terminates) {
            this.destroy()
        }
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
        this._destroy({ module: 'destructible', method: 'initializer', terminates: terminates, key: key }, error)
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
        if (callback === null) {
            callback = this._monitor('initializer', [ key, true ])
        }
        if (this.destroyed) {
            this.completed.wait(errorify(callback, 'destroyed', {
                module: 'destructible',
                key: this.key,
                waiting: this.waiting.slice(),
                context: this.context
            }))
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
