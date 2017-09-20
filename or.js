module.exports = function (block, callback) {
    var invoked = false
    block(function () {
        if (!invoked) {
            invoked = true
            callback.apply(null, Array.prototype.slice.call(arguments))
        }
    })
}
