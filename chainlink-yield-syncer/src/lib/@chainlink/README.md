Ref:
https://github.com/smartcontractkit/functions-toolkit

Several issues faced with this library:
- uses ethers 5, ehcih conflicts with the one used in the lambda
- too many dependencies which makes the lambda > 256 MB limit
- has ganache as internal dependency, which requires fsevents, which breaks on linux => npm ci command fails when running `sam build`
