import click

a = {
    "test": "foo"
    # TODO Add a "fib" key with a value of "bar"
}

def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


@click.command()
# TODO Add a click option for the number n
def main(n):
    print(fib(n))


if __name__ == "__main__":
    main()