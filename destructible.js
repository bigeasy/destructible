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
    this.key = coalesce(key)
    this._destructors = {}
    this.waiting = []
    this.instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this._destructing = new Signal
    this._destroyed = new Signal
    this._index = 0
    this._vargs = []
}

Destructible.prototype._destroy = function (key, error) {
    if (error != null) {
        this.errors.push(error)
        this.interrupts.push(interrupt('error', { key: key }, error))
    }
    if (!this.destroyed) {
        this._destroyedAt = Date.now()
        this._destructing.unlatch()
        this.destroyed = true
        for (var key in this._destructors) {
            try {
                this._destructors[key].call()
            } catch (error) {
                throw interrupt('destructor', error, {
                    destructible: this.key,
                    destructor: Keyify.parse(key)
                })
            }
        }
    }
}

Destructible.prototype._complete = function () {
    if (this.waiting.length == 0 && this._destroyed.open == null) {
        if (this.errors.length) {
            this._destroyed.unlatch(this.errors[0])
        } else {
            var vargs = [ null ]
            vargs = vargs.concat.apply(vargs, this._vargs)
            this._destroyed.unlatch.apply(this._destroyed, vargs)
        }
    }
}

Destructible.prototype.destroy = function (error) {
    this._destroy({ module: 'destructible', method: 'destroy' }, coalesce(error))
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
    interrupt.assert(! this.destroyed, 'destroyed', this.errors[0], {
        destructible: this.key,
        destructor: key
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

Destructible.prototype.monitor = function (key) {
    var wait = { module: 'destructible', method: 'monitor', key: key }
    this.waiting.push(wait)
    var index = this._index++
    return Operation([ this, function (error) {
        this._vargs[index] = Array.prototype.slice.call(arguments, 1)
        this._destroy({ module: 'destructible', method: 'monitor', key: key }, coalesce(error))
        this.waiting.splice(this.waiting.indexOf(wait), 1)
        this._complete()
    } ])
}

Destructible.prototype.rescue = function (key) {
    var wait = { module: 'destructible', method: 'rescue', key: key }
    this.waiting.push(wait)
    return Operation([ this, function (error) {
        if (error != null) {
            this._destroy({ module: 'destructible', method: 'rescue', key: key }, error)
        }
        this.waiting.splice(this.waiting.indexOf(wait), 1)
        if (this.destroyed) {
            this._complete()
        }
    } ])
}

Destructible.prototype._completed = cadence(function (async, timeout) {
    async(function () {
        this._destructing.wait(async())
    }, function () {
        timeout -= (this._destroyedAt - Date.now())
        this._destroyed.wait(Math.max(timeout, 0), async())
    }, function () {
        panicIf(this._destroyed.open == null, 'hung', {
            destructible: this.key,
            waiting: this.waiting.slice(),
        }, { cause: coalesce(this.errors[0]) })
    })
})

Destructible.prototype.completed = function (timeout, callback) {
    var vargs = Array.prototype.slice.call(arguments)
    timeout = typeof vargs[0] == 'number' ? vargs.shift() : 30000
    this._completed(timeout, vargs.shift())
}

module.exports = Destructible
