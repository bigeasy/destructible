var Destructible = require('../../destructible')
var Destructible_ = require('../../_destructible')
var Benchmark = require('benchmark')

var suite = new Benchmark.Suite('call')

function create (Destructible) {
    return function () { new Destructible('destructible').destroy() }
}

create(Destructible)()

for (var i = 1; i <= 4; i++)  {
    suite.add({
        name: '_destructible create ' + i,
        fn: create(Destructible_)
    })

    suite.add({
        name: ' destructible create ' + i,
        fn: create(Destructible)
    })
}

suite.on('cycle', function(event) {
    console.log(String(event.target));
})

suite.on('complete', function() {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
})

suite.run()
