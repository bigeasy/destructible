var cadence = require('cadence')
var coalesce = require('nascent.coalesce')
var DEFAULT = {
    interrupt: require('interrupt').createInterrupter('nascent.destructor')
}
var Operation = require('operation')

function Destructor (interrupt) {
    this._interrupt = coalesce(interrupt, DEFAULT.interrupt)
    this.destroyed = false
    this.cause = null
    this._destructors = {}
    this._markers = []
    this.asListener = this.asCallback = this.destroy.bind(this)
}

Destructor.prototype.destroy = function (error) {
    if (error) {
        this.check()
        this.cause = error
    }
    if (!this.destroyed) {
        this.destroyed = true
        for (var name in this._destructors) {
            this._destructors[name].apply([])
        }
        this._destructors = null
        this._markers.forEach(function (f) { f() })
        this._markers = null
    }
}

Destructor.prototype.markDestroyed = function (object, property) {
    this._markers.push(function () { object[property] = true })
}

Destructor.prototype.addDestructor = function (name, operation) {
    if (this.destroyed) {
        operation.apply([])
    } else {
        this._destructors[name] = new Operation(operation)
    }
}

Destructor.prototype.invokeDestructor = function (name) {
    this._destructors[name].apply([])
    delete this._destructors[name]
}

Destructor.prototype.removeDestructor = function (name) {
    delete this._destructors[name]
}

Destructor.prototype.getDestructors = function () {
    return Object.keys(this._destructors)
}

Destructor.prototype.check = function () {
    if (this.destroyed) {
        throw this._interrupt('destroyed', {}, { cause: coalesce(this.cause) })
    }
}

Destructor.prototype.destructable = cadence(function (async, f) {
    if (!this.destroyed) {
        async([function () {
            this.destroy()
        }], [function () {
            f(async())
        }, function (error) {
            if (!this.destroyed) {
                this.destroy(error)
            }
            throw error
        }])
    }
})

module.exports = Destructor
