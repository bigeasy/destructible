const fs = require('fs').promises

async function unloaded () {
    return 1
}

function loaded () {
    return fs.readFile(__filename)
}

async function main () {
    for (const Destructible of [ require('../_destructible'), require('..') ]) {
        const Destructible = require('..')
        const destructible = new Destructible('benchmark')

        console.log('called')

        let start = 0

        for (const [ f, count ] of [[ loaded, 30000 ], [ unloaded, 10000000 ]]) {
            start = Date.now()
            for (let i = 0; i < count; i++) {
                await f()
            }
            console.log(Date.now() - start)

            start = Date.now()
            for (let i = 0; i < count; i++) {
                await destructible.ephemeral('foo', f())
            }
            console.log(Date.now() - start)

            start = Date.now()
            for (let i = 0; i < count; i++) {
                await destructible.ephemeral('foo', f)
            }
            console.log(Date.now() - start)
        }

        console.log('done')
    }
}

main()
