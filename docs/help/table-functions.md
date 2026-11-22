# Table function reference

Every function a table formula can use, 394 in all.
This page is generated from the function registry. Do not edit it by hand.

Square brackets mark an optional argument. "..." means the argument can repeat.
See [Tables and charts](tables-and-charts.md) for how formulas work.
See [Table formatting](table-formatting.md) for number formats.

## Math and trigonometry

| Function | Call | What it does |
| --- | --- | --- |
| `ABS` | `ABS(number)` | Gives the size of a number, without its sign. |
| `ACOS` | `ACOS(number)` | Gives the angle, in radians, whose cosine is the number. |
| `ACOSH` | `ACOSH(number)` | Gives the inverse hyperbolic cosine of a number that is at least 1. |
| `ACOT` | `ACOT(number)` | Gives the angle, in radians from 0 to pi, whose cotangent is the number. |
| `ACOTH` | `ACOTH(number)` | Gives the inverse hyperbolic cotangent of a number beyond -1 and 1. |
| `ADD` | `ADD(a, b)` | Adds two numbers. |
| `AGGREGATE` | `AGGREGATE(function, options, ref, ...)` | Calculates a sum, count, average, or other measure over cells. You choose which rows and errors to ignore. |
| `ARABIC` | `ARABIC(text)` | Turns a Roman numeral into a number. |
| `ASIN` | `ASIN(number)` | Gives the angle, in radians, whose sine is the number. |
| `ASINH` | `ASINH(number)` | Gives the inverse hyperbolic sine of a number. |
| `ATAN` | `ATAN(number)` | Gives the angle, in radians, whose tangent is the number. |
| `ATAN2` | `ATAN2(x, y)` | Gives the angle, in radians, of the point at x and y, measured from the x axis. |
| `ATANH` | `ATANH(number)` | Gives the inverse hyperbolic tangent of a number between -1 and 1. |
| `BASE` | `BASE(number, radix, [minLength])` | Writes a whole number in another base, such as binary or hexadecimal. |
| `CEILING` | `CEILING(number, [step])` | Rounds a number up to a multiple of the step. |
| `CEILING.MATH` | `CEILING.MATH(number, [step], [mode])` | Rounds a number up to a multiple of the step, with a choice for negative numbers. |
| `CEILING.PRECISE` | `CEILING.PRECISE(number, [step])` | Rounds a number up to a multiple of the step, whatever the sign of either. |
| `COMBIN` | `COMBIN(number, chosen)` | Counts the ways to choose items from a group, when order does not matter. |
| `COMBINA` | `COMBINA(number, chosen)` | Counts the ways to choose items from a group when an item may be chosen more than once. |
| `COS` | `COS(number)` | Gives the cosine of an angle in radians. |
| `COSH` | `COSH(number)` | Gives the hyperbolic cosine of a number. |
| `COT` | `COT(number)` | Gives the cotangent of an angle in radians. |
| `COTH` | `COTH(number)` | Gives the hyperbolic cotangent of a number. |
| `CSC` | `CSC(number)` | Gives the cosecant of an angle in radians. |
| `CSCH` | `CSCH(number)` | Gives the hyperbolic cosecant of a number. |
| `DECIMAL` | `DECIMAL(text, radix)` | Reads text written in another base and gives its value. |
| `DEGREES` | `DEGREES(number)` | Turns an angle in radians into degrees. |
| `DIVIDE` | `DIVIDE(a, b)` | Divides one number by another. |
| `EVEN` | `EVEN(number)` | Rounds a number away from zero to the next even whole number. |
| `EXP` | `EXP(number)` | Gives e raised to a power. |
| `FACT` | `FACT(number)` | Gives the factorial of a number: the product of the whole numbers from 1 up to it. |
| `FACTDOUBLE` | `FACTDOUBLE(number)` | Gives the double factorial: the product of every second whole number down from the number. |
| `FLOOR` | `FLOOR(number, [step])` | Rounds a number down to a multiple of the step. |
| `FLOOR.MATH` | `FLOOR.MATH(number, [step], [mode])` | Rounds a number down to a multiple of the step, with a choice for negative numbers. |
| `FLOOR.PRECISE` | `FLOOR.PRECISE(number, [step])` | Rounds a number down to a multiple of the step, whatever the sign of either. |
| `GCD` | `GCD(number, ...)` | Gives the largest whole number that divides every number given. |
| `INT` | `INT(number)` | Rounds a number down to the nearest whole number. |
| `ISO.CEILING` | `ISO.CEILING(number, [step])` | Rounds a number up to a multiple of the step, whatever the sign of either. |
| `LCM` | `LCM(number, ...)` | Gives the smallest whole number that every number given divides. |
| `LN` | `LN(number)` | Gives the natural logarithm of a number. |
| `LOG` | `LOG(number, [base])` | Gives the logarithm of a number to the base you choose. |
| `LOG10` | `LOG10(number)` | Gives the base 10 logarithm of a number. |
| `MINUS` | `MINUS(a, b)` | Subtracts the second number from the first. |
| `MOD` | `MOD(number, divisor)` | Gives the remainder after division. The result has the sign of the divisor. |
| `MROUND` | `MROUND(number, multiple)` | Rounds a number to the nearest multiple. |
| `MULTINOMIAL` | `MULTINOMIAL(number, ...)` | Counts the ways to split a group into parts of the sizes given. |
| `MULTIPLY` | `MULTIPLY(a, b)` | Multiplies two numbers. |
| `ODD` | `ODD(number)` | Rounds a number away from zero to the next odd whole number. |
| `PERCENTOF` | `PERCENTOF(part, whole)` | Gives what share of the total the first cells make up. |
| `PI` | `PI()` | Gives pi, 3.14159265358979. |
| `POWER` | `POWER(number, power)` | Raises a number to a power. |
| `PRODUCT` | `PRODUCT(value, ...)` | Multiplies the numbers together. |
| `QUOTIENT` | `QUOTIENT(dividend, divisor)` | Gives the whole part of a division, dropping the remainder. |
| `RADIANS` | `RADIANS(number)` | Turns an angle in degrees into radians. |
| `RAND` | `RAND()` | Gives a random number from 0 up to, but not including, 1. It changes on every calculation. |
| `RANDBETWEEN` | `RANDBETWEEN(bottom, top)` | Gives a random whole number between two limits. It changes on every calculation. |
| `ROMAN` | `ROMAN(number, [form])` | Writes a number from 0 to 3999 as a Roman numeral. |
| `ROUND` | `ROUND(number, [digits])` | Rounds a number to a set number of decimal places, halves away from zero. |
| `ROUNDDOWN` | `ROUNDDOWN(number, [digits])` | Rounds a number toward zero to a set number of decimal places. |
| `ROUNDUP` | `ROUNDUP(number, [digits])` | Rounds a number away from zero to a set number of decimal places. |
| `SEC` | `SEC(number)` | Gives the secant of an angle in radians. |
| `SECH` | `SECH(number)` | Gives the hyperbolic secant of a number. |
| `SERIESSUM` | `SERIESSUM(x, n, m, coefficients)` | Adds the terms of a power series: each coefficient times x raised to a growing power. |
| `SIGN` | `SIGN(number)` | Gives 1 for a positive number, -1 for a negative one, and 0 for zero. |
| `SIN` | `SIN(number)` | Gives the sine of an angle in radians. |
| `SINH` | `SINH(number)` | Gives the hyperbolic sine of a number. |
| `SQRT` | `SQRT(number)` | Gives the square root of a number. |
| `SQRTPI` | `SQRTPI(number)` | Gives the square root of a number times pi. |
| `SUBTOTAL` | `SUBTOTAL(function, ref, ...)` | Calculates a sum, count, average, or other measure over a range, skipping filtered rows. Numbers from 101 up also skip hidden rows. |
| `SUM` | `SUM(value, ...)` | Adds the numbers together. |
| `SUMIF` | `SUMIF(range, criterion, [sumRange])` | Adds the cells that meet a test. |
| `SUMIFS` | `SUMIFS(sumRange, criteriaRange, criterion, ...)` | Adds the cells whose matching cells meet every test. |
| `SUMPRODUCT` | `SUMPRODUCT(array, ...)` | Multiplies matching items of the blocks and adds the products. |
| `SUMSQ` | `SUMSQ(value, ...)` | Adds the squares of the numbers. |
| `SUMX2MY2` | `SUMX2MY2(arrayX, arrayY)` | Adds the difference of the squares of matching items in two blocks. |
| `SUMX2PY2` | `SUMX2PY2(arrayX, arrayY)` | Adds the sum of the squares of matching items in two blocks. |
| `SUMXMY2` | `SUMXMY2(arrayX, arrayY)` | Adds the squares of the differences of matching items in two blocks. |
| `TAN` | `TAN(number)` | Gives the tangent of an angle in radians. |
| `TANH` | `TANH(number)` | Gives the hyperbolic tangent of a number. |
| `TRUNC` | `TRUNC(number, [digits])` | Cuts a number to a set number of decimal places, toward zero. |

## Arrays

| Function | Call | What it does |
| --- | --- | --- |
| `ARRAYFORMULA` | `ARRAYFORMULA(array_formula)` | Gives a formula as it is. |
| `CHOOSECOLS` | `CHOOSECOLS(array, col_num, ...)` | Takes the chosen columns of an array. |
| `CHOOSEROWS` | `CHOOSEROWS(array, row_num, ...)` | Takes the chosen rows of an array. |
| `DROP` | `DROP(array, rows, [columns])` | Removes rows or columns from the start or the end of an array. |
| `EXPAND` | `EXPAND(array, rows, [columns], [pad_with])` | Makes an array larger, filling the new cells. |
| `FILTER` | `FILTER(array, include, [if_empty])` | Keeps the rows (or columns) of an array that pass a test. |
| `FLATTEN` | `FLATTEN(range, ...)` | Puts every value of the ranges in one column, row by row. |
| `HSTACK` | `HSTACK(array, ...)` | Joins arrays side by side. |
| `MDETERM` | `MDETERM(array)` | Gives the determinant of a square matrix. |
| `MINVERSE` | `MINVERSE(array)` | Gives the inverse of a square matrix. |
| `MMULT` | `MMULT(array1, array2)` | Multiplies a matrix by another. |
| `MUNIT` | `MUNIT(dimension)` | Gives the identity matrix of a size. |
| `RANDARRAY` | `RANDARRAY([rows], [columns], [min], [max], [integer])` | Gives an array of random numbers. |
| `SEQUENCE` | `SEQUENCE(rows, [columns], [start], [step])` | Gives an array of numbers that grow by a step. |
| `SORT` | `SORT(array, [sort_index], [sort_order], [by_col])` | Sorts the rows (or columns) of an array. |
| `SORTBY` | `SORTBY(array, by_array, [sort_order], ...)` | Sorts an array by the values of other rows or columns. |
| `SORTN` | `SORTN(range, [n], [display_ties_mode], [sort_column, is_ascending], ...)` | Sorts a range and keeps its first rows. |
| `TAKE` | `TAKE(array, rows, [columns])` | Keeps rows or columns from the start or the end of an array. |
| `TOCOL` | `TOCOL(array, [ignore], [scan_by_column])` | Puts every value of an array in one column. |
| `TOROW` | `TOROW(array, [ignore], [scan_by_column])` | Puts every value of an array in one row. |
| `TRANSPOSE` | `TRANSPOSE(array)` | Swaps the rows and columns of an array. |
| `TRIMRANGE` | `TRIMRANGE(range, [trim_rows], [trim_cols])` | Removes the empty rows and columns at the edges of a range. |
| `UNIQUE` | `UNIQUE(array, [by_col], [exactly_once])` | Keeps each distinct row (or column) of an array once. |
| `VSTACK` | `VSTACK(array, ...)` | Joins arrays one above the other. |
| `WRAPCOLS` | `WRAPCOLS(vector, wrap_count, [pad_with])` | Cuts a row or column of values into columns of a set length. |
| `WRAPROWS` | `WRAPROWS(vector, wrap_count, [pad_with])` | Cuts a row or column of values into rows of a set length. |

## Statistics

| Function | Call | What it does |
| --- | --- | --- |
| `AVEDEV` | `AVEDEV(value, ...)` | Gives the average distance of the numbers from their mean. |
| `AVERAGE` | `AVERAGE(value, ...)` | Gives the mean of the numbers. |
| `AVERAGEA` | `AVERAGEA(value, ...)` | Gives the mean of the values, with text as 0 and TRUE as 1. |
| `AVERAGEIF` | `AVERAGEIF(range, criterion, [averageRange])` | Gives the mean of the cells whose matching cells meet a test. |
| `AVERAGEIFS` | `AVERAGEIFS(averageRange, criteriaRange, criterion, ...)` | Gives the mean of the cells whose matching cells meet every test. |
| `BETA.DIST` | `BETA.DIST(x, alpha, beta, cumulative, [lower], [upper])` | Gives the beta distribution at x, between optional bounds. |
| `BETA.INV` | `BETA.INV(probability, alpha, beta, [lower], [upper])` | Gives the x at which the cumulative beta distribution reaches a probability. |
| `BINOM.DIST` | `BINOM.DIST(successes, trials, probability, cumulative)` | Gives the chance of a number of successes in a set of trials. |
| `BINOM.DIST.RANGE` | `BINOM.DIST.RANGE(trials, probability, successes, [successes2])` | Gives the chance that the successes fall within a range. |
| `BINOM.INV` | `BINOM.INV(trials, probability, alpha)` | Gives the fewest successes whose cumulative chance reaches alpha. |
| `CHISQ.DIST` | `CHISQ.DIST(x, degrees, cumulative)` | Gives the chi-squared distribution at x. |
| `CHISQ.DIST.RT` | `CHISQ.DIST.RT(x, degrees)` | Gives the chance of a chi-squared value above x. |
| `CHISQ.INV` | `CHISQ.INV(probability, degrees)` | Gives the x below which a chi-squared value falls with a probability. |
| `CHISQ.INV.RT` | `CHISQ.INV.RT(probability, degrees)` | Gives the x above which a chi-squared value falls with a probability. |
| `CHISQ.TEST` | `CHISQ.TEST(actual, expected)` | Tests whether observed counts fit expected ones, and gives the chance. |
| `CONFIDENCE.NORM` | `CONFIDENCE.NORM(alpha, sd, size)` | Gives half the width of a confidence interval for a mean, by the normal law. |
| `CONFIDENCE.T` | `CONFIDENCE.T(alpha, sd, size)` | Gives half the width of a confidence interval for a mean, by Student's t law. |
| `CORREL` | `CORREL(array1, array2)` | Gives the correlation of two blocks of numbers, from -1 to 1. |
| `COUNT` | `COUNT(value, ...)` | Counts the numbers. |
| `COUNTA` | `COUNTA(value, ...)` | Counts the cells that are not empty. |
| `COUNTBLANK` | `COUNTBLANK(value, ...)` | Counts the empty cells. |
| `COUNTIF` | `COUNTIF(range, criterion)` | Counts the cells that meet a test. |
| `COUNTIFS` | `COUNTIFS(criteriaRange, criterion, ...)` | Counts the rows whose cells meet every test. |
| `COUNTUNIQUE` | `COUNTUNIQUE(value, ...)` | Counts the different values, leaving out empty cells. |
| `COVARIANCE.P` | `COVARIANCE.P(array1, array2)` | Gives the population covariance of two blocks of numbers. |
| `COVARIANCE.S` | `COVARIANCE.S(array1, array2)` | Gives the sample covariance of two blocks of numbers. |
| `DEVSQ` | `DEVSQ(value, ...)` | Adds the squared distances of the numbers from their mean. |
| `EXPON.DIST` | `EXPON.DIST(x, lambda, cumulative)` | Gives the exponential distribution at x. |
| `F.DIST` | `F.DIST(x, degrees1, degrees2, cumulative)` | Gives the F distribution at x. |
| `F.DIST.RT` | `F.DIST.RT(x, degrees1, degrees2)` | Gives the chance of an F value above x. |
| `F.INV` | `F.INV(probability, degrees1, degrees2)` | Gives the x below which an F value falls with a probability. |
| `F.INV.RT` | `F.INV.RT(probability, degrees1, degrees2)` | Gives the x above which an F value falls with a probability. |
| `F.TEST` | `F.TEST(array1, array2)` | Tests whether two samples have the same variance, and gives the two-tailed chance. |
| `FISHER` | `FISHER(x)` | Gives the Fisher transform of a correlation. |
| `FISHERINV` | `FISHERINV(y)` | Turns a Fisher transform back into a correlation. |
| `FORECAST` | `FORECAST(x, knownY, knownX)` | Predicts y at x from a straight line through known points. |
| `FORECAST.ETS` | `FORECAST.ETS(target, values, timeline, [seasonality], [completion], [aggregation])` | Forecasts a value by exponential smoothing with trend and season. |
| `FORECAST.ETS.CONFINT` | `FORECAST.ETS.CONFINT(target, values, timeline, [confidence], [seasonality], [completion], [aggregation])` | Gives half the width of the confidence interval of an exponential smoothing forecast. |
| `FORECAST.ETS.SEASONALITY` | `FORECAST.ETS.SEASONALITY(values, timeline, [completion], [aggregation])` | Gives the season length that exponential smoothing finds in a series. |
| `FORECAST.ETS.STAT` | `FORECAST.ETS.STAT(values, timeline, statistic, [seasonality], [completion], [aggregation])` | Gives a measure of an exponential smoothing fit, such as its error. |
| `FORECAST.LINEAR` | `FORECAST.LINEAR(x, knownY, knownX)` | Predicts y at x from a straight line through known points. |
| `FREQUENCY` | `FREQUENCY(data, bins)` | Counts how many values fall in each bin, as a column. |
| `GAMMA` | `GAMMA(x)` | Gives the gamma function of a number. |
| `GAMMA.DIST` | `GAMMA.DIST(x, alpha, beta, cumulative)` | Gives the gamma distribution at x. |
| `GAMMA.INV` | `GAMMA.INV(probability, alpha, beta)` | Gives the x at which the cumulative gamma distribution reaches a probability. |
| `GAMMALN` | `GAMMALN(x)` | Gives the natural logarithm of the gamma function. |
| `GAMMALN.PRECISE` | `GAMMALN.PRECISE(x)` | Gives the natural logarithm of the gamma function. |
| `GAUSS` | `GAUSS(z)` | Gives the chance that a standard normal value falls between the mean and z. |
| `GEOMEAN` | `GEOMEAN(value, ...)` | Gives the geometric mean of positive numbers. |
| `GROWTH` | `GROWTH(knownY, [knownX], [newX], [const])` | Predicts values on an exponential curve fitted to known points. |
| `HARMEAN` | `HARMEAN(value, ...)` | Gives the harmonic mean of positive numbers. |
| `HYPGEOM.DIST` | `HYPGEOM.DIST(sampleS, sample, populationS, population, cumulative)` | Gives the chance of a number of successes when drawing without putting items back. |
| `INTERCEPT` | `INTERCEPT(knownY, knownX)` | Gives where the least-squares line crosses the y axis. |
| `KURT` | `KURT(value, ...)` | Gives how heavy the tails of the numbers are, compared with the normal law. |
| `LARGE` | `LARGE(array, k)` | Gives the k-th largest number. |
| `LINEST` | `LINEST(knownY, [knownX], [const], [stats])` | Fits a straight line or plane by least squares and gives its coefficients. |
| `LOGEST` | `LOGEST(knownY, [knownX], [const], [stats])` | Fits an exponential curve and gives its factors. |
| `LOGNORM.DIST` | `LOGNORM.DIST(x, mean, sd, cumulative)` | Gives the lognormal distribution at x. |
| `LOGNORM.INV` | `LOGNORM.INV(probability, mean, sd)` | Gives the x at which the cumulative lognormal distribution reaches a probability. |
| `MAX` | `MAX(value, ...)` | Gives the largest number. |
| `MAXA` | `MAXA(value, ...)` | Gives the largest value, with text as 0 and TRUE as 1. |
| `MAXIFS` | `MAXIFS(maxRange, criteriaRange, criterion, ...)` | Gives the largest of the cells whose rows meet every test. |
| `MEDIAN` | `MEDIAN(value, ...)` | Gives the middle number. |
| `MIN` | `MIN(value, ...)` | Gives the smallest number. |
| `MINA` | `MINA(value, ...)` | Gives the smallest value, with text as 0 and TRUE as 1. |
| `MINIFS` | `MINIFS(minRange, criteriaRange, criterion, ...)` | Gives the smallest of the cells whose rows meet every test. |
| `MODE.MULT` | `MODE.MULT(value, ...)` | Gives every most common number, as a column. |
| `MODE.SNGL` | `MODE.SNGL(value, ...)` | Gives the most common number. |
| `NEGBINOM.DIST` | `NEGBINOM.DIST(failures, successes, probability, cumulative)` | Gives the chance of a number of failures before a number of successes. |
| `NORM.DIST` | `NORM.DIST(x, mean, sd, cumulative)` | Gives the normal distribution at x. |
| `NORM.INV` | `NORM.INV(probability, mean, sd)` | Gives the x at which the cumulative normal distribution reaches a probability. |
| `NORM.S.DIST` | `NORM.S.DIST(z, cumulative)` | Gives the standard normal distribution at z. |
| `NORM.S.INV` | `NORM.S.INV(probability)` | Gives the z at which the cumulative standard normal distribution reaches a probability. |
| `PEARSON` | `PEARSON(array1, array2)` | Gives the Pearson correlation of two blocks of numbers. |
| `PERCENTILE.EXC` | `PERCENTILE.EXC(array, k)` | Gives the value at a fraction of the way through the numbers, with 0 and 1 left out. |
| `PERCENTILE.INC` | `PERCENTILE.INC(array, k)` | Gives the value at a fraction of the way through the numbers, from 0 to 1. |
| `PERCENTRANK.EXC` | `PERCENTRANK.EXC(array, x, [significance])` | Gives the share of the numbers below a value, with 0 and 1 left out. |
| `PERCENTRANK.INC` | `PERCENTRANK.INC(array, x, [significance])` | Gives the share of the numbers below a value, from 0 to 1. |
| `PERMUT` | `PERMUT(number, chosen)` | Counts the ordered ways to choose items without repeats. |
| `PERMUTATIONA` | `PERMUTATIONA(number, chosen)` | Counts the ordered ways to choose items with repeats. |
| `PHI` | `PHI(x)` | Gives the standard normal density at x. |
| `POISSON.DIST` | `POISSON.DIST(x, mean, cumulative)` | Gives the chance of a number of events by the Poisson law. |
| `PROB` | `PROB(xRange, probRange, lower, [upper])` | Gives the chance that a value falls between two limits. |
| `QUARTILE.EXC` | `QUARTILE.EXC(array, quart)` | Gives a quartile of the numbers, with 0 and 1 left out. |
| `QUARTILE.INC` | `QUARTILE.INC(array, quart)` | Gives a quartile of the numbers, from the smallest to the largest. |
| `RANK.AVG` | `RANK.AVG(number, ref, [order])` | Gives the place of a number in a list; ties share the average place. |
| `RANK.EQ` | `RANK.EQ(number, ref, [order])` | Gives the place of a number in a list; ties share the top place. |
| `RSQ` | `RSQ(knownY, knownX)` | Gives the square of the correlation of known y and known x. |
| `SKEW` | `SKEW(value, ...)` | Gives how lopsided a sample is around its mean. |
| `SKEW.P` | `SKEW.P(value, ...)` | Gives how lopsided a population is around its mean. |
| `SLOPE` | `SLOPE(knownY, knownX)` | Gives the slope of the least-squares line. |
| `SMALL` | `SMALL(array, k)` | Gives the k-th smallest number. |
| `STANDARDIZE` | `STANDARDIZE(x, mean, sd)` | Gives how many standard deviations x is from the mean. |
| `STDEV.P` | `STDEV.P(value, ...)` | Gives the standard deviation of a whole population. |
| `STDEV.S` | `STDEV.S(value, ...)` | Gives the standard deviation of a sample. |
| `STDEVA` | `STDEVA(value, ...)` | Gives the sample standard deviation, with text as 0 and TRUE as 1. |
| `STDEVPA` | `STDEVPA(value, ...)` | Gives the population standard deviation, with text as 0 and TRUE as 1. |
| `STEYX` | `STEYX(knownY, knownX)` | Gives the standard error of the y values predicted by the least-squares line. |
| `T.DIST` | `T.DIST(x, degrees, cumulative)` | Gives Student's t distribution at x. |
| `T.DIST.2T` | `T.DIST.2T(x, degrees)` | Gives the chance of a t value farther from 0 than x, in both tails. |
| `T.DIST.RT` | `T.DIST.RT(x, degrees)` | Gives the chance of a t value above x. |
| `T.INV` | `T.INV(probability, degrees)` | Gives the t value below which a value falls with a probability. |
| `T.INV.2T` | `T.INV.2T(probability, degrees)` | Gives the t value beyond which a value falls with a probability, in both tails. |
| `T.TEST` | `T.TEST(array1, array2, tails, type)` | Gives the chance from Student's t test that two samples share a mean. |
| `TREND` | `TREND(knownY, [knownX], [newX], [const])` | Predicts values on a straight line fitted to known points. |
| `TRIMMEAN` | `TRIMMEAN(array, percent)` | Gives the mean after leaving out a share of the smallest and largest numbers. |
| `VAR.P` | `VAR.P(value, ...)` | Gives the variance of a whole population. |
| `VAR.S` | `VAR.S(value, ...)` | Gives the variance of a sample. |
| `VARA` | `VARA(value, ...)` | Gives the sample variance, with text as 0 and TRUE as 1. |
| `VARPA` | `VARPA(value, ...)` | Gives the population variance, with text as 0 and TRUE as 1. |
| `WEIBULL.DIST` | `WEIBULL.DIST(x, alpha, beta, cumulative)` | Gives the Weibull distribution at x. |
| `Z.TEST` | `Z.TEST(array, x, [sigma])` | Gives the one-tailed chance of a sample mean at least this far above x. |

## Statistics, older names

| Function | Call | What it does |
| --- | --- | --- |
| `BETADIST` | `BETADIST(x, alpha, beta, [lower], [upper])` | Gives the cumulative beta distribution. An older name for BETA.DIST. |
| `BETAINV` | `BETAINV(probability, alpha, beta, [lower], [upper])` | Gives the inverse of the cumulative beta distribution. An older name for BETA.INV. |
| `BINOMDIST` | `BINOMDIST(successes, trials, probability, cumulative)` | Gives a binomial chance. An older name for BINOM.DIST. |
| `CHIDIST` | `CHIDIST(x, degrees)` | Gives the chance of a chi-squared value above x. An older name for CHISQ.DIST.RT. |
| `CHIINV` | `CHIINV(probability, degrees)` | Gives the x above which a chi-squared value falls. An older name for CHISQ.INV.RT. |
| `CHITEST` | `CHITEST(actual, expected)` | Tests observed counts against expected ones. An older name for CHISQ.TEST. |
| `CONFIDENCE` | `CONFIDENCE(alpha, sd, size)` | Gives half a normal confidence interval. An older name for CONFIDENCE.NORM. |
| `COVAR` | `COVAR(array1, array2)` | Gives the population covariance. An older name for COVARIANCE.P. |
| `CRITBINOM` | `CRITBINOM(trials, probability, alpha)` | Gives the fewest successes that reach alpha. An older name for BINOM.INV. |
| `EXPONDIST` | `EXPONDIST(x, lambda, cumulative)` | Gives the exponential distribution. An older name for EXPON.DIST. |
| `FDIST` | `FDIST(x, degrees1, degrees2)` | Gives the chance of an F value above x. An older name for F.DIST.RT. |
| `FINV` | `FINV(probability, degrees1, degrees2)` | Gives the x above which an F value falls. An older name for F.INV.RT. |
| `FTEST` | `FTEST(array1, array2)` | Tests whether two variances match. An older name for F.TEST. |
| `GAMMADIST` | `GAMMADIST(x, alpha, beta, cumulative)` | Gives the gamma distribution. An older name for GAMMA.DIST. |
| `GAMMAINV` | `GAMMAINV(probability, alpha, beta)` | Gives the inverse of the cumulative gamma distribution. An older name for GAMMA.INV. |
| `HYPGEOMDIST` | `HYPGEOMDIST(sampleS, sample, populationS, population)` | Gives a hypergeometric chance. An older name for HYPGEOM.DIST. |
| `LOGINV` | `LOGINV(probability, mean, sd)` | Gives the inverse of the cumulative lognormal distribution. An older name for LOGNORM.INV. |
| `LOGNORMDIST` | `LOGNORMDIST(x, mean, sd)` | Gives the cumulative lognormal distribution. An older name for LOGNORM.DIST. |
| `MODE` | `MODE(value, ...)` | Gives the most common number. An older name for MODE.SNGL. |
| `NEGBINOMDIST` | `NEGBINOMDIST(failures, successes, probability)` | Gives a negative binomial chance. An older name for NEGBINOM.DIST. |
| `NORMDIST` | `NORMDIST(x, mean, sd, cumulative)` | Gives the normal distribution. An older name for NORM.DIST. |
| `NORMINV` | `NORMINV(probability, mean, sd)` | Gives the inverse of the cumulative normal distribution. An older name for NORM.INV. |
| `NORMSDIST` | `NORMSDIST(z)` | Gives the cumulative standard normal distribution. An older name for NORM.S.DIST. |
| `NORMSINV` | `NORMSINV(probability)` | Gives the inverse of the standard normal distribution. An older name for NORM.S.INV. |
| `PERCENTILE` | `PERCENTILE(array, k)` | Gives a percentile from 0 to 1. An older name for PERCENTILE.INC. |
| `PERCENTRANK` | `PERCENTRANK(array, x, [significance])` | Gives the share of numbers below a value. An older name for PERCENTRANK.INC. |
| `POISSON` | `POISSON(x, mean, cumulative)` | Gives a Poisson chance. An older name for POISSON.DIST. |
| `QUARTILE` | `QUARTILE(array, quart)` | Gives a quartile. An older name for QUARTILE.INC. |
| `RANK` | `RANK(number, ref, [order])` | Gives the place of a number in a list. An older name for RANK.EQ. |
| `STDEV` | `STDEV(value, ...)` | Gives the sample standard deviation. An older name for STDEV.S. |
| `STDEVP` | `STDEVP(value, ...)` | Gives the population standard deviation. An older name for STDEV.P. |
| `TDIST` | `TDIST(x, degrees, tails)` | Gives one or both tails of Student's t law beyond x, for x at least 0. |
| `TINV` | `TINV(probability, degrees)` | Gives the two-tailed inverse of t. An older name for T.INV.2T. |
| `TTEST` | `TTEST(array1, array2, tails, type)` | Gives the chance from Student's t test. An older name for T.TEST. |
| `VAR` | `VAR(value, ...)` | Gives the sample variance. An older name for VAR.S. |
| `VARP` | `VARP(value, ...)` | Gives the population variance. An older name for VAR.P. |
| `WEIBULL` | `WEIBULL(x, alpha, beta, cumulative)` | Gives the Weibull distribution. An older name for WEIBULL.DIST. |
| `ZTEST` | `ZTEST(array, x, [sigma])` | Gives the one-tailed chance of a z test. An older name for Z.TEST. |

## Text

| Function | Call | What it does |
| --- | --- | --- |
| `ARRAYTOTEXT` | `ARRAYTOTEXT(array, [format])` |  |
| `ASC` | `ASC(text)` |  |
| `BAHTTEXT` | `BAHTTEXT(number)` |  |
| `CHAR` | `CHAR(number)` |  |
| `CLEAN` | `CLEAN(text)` |  |
| `CODE` | `CODE(text)` |  |
| `CONCAT` | `CONCAT(text, ...)` |  |
| `CONCATENATE` | `CONCATENATE(text, ...)` |  |
| `DBCS` | `DBCS(text)` |  |
| `DOLLAR` | `DOLLAR(number, [decimals])` |  |
| `ENCODEURL` | `ENCODEURL(text)` |  |
| `EXACT` | `EXACT(text1, text2)` |  |
| `FIND` | `FIND(find_text, within_text, [start_num])` |  |
| `FINDB` | `FINDB(find_text, within_text, [start_num])` |  |
| `FIXED` | `FIXED(number, [decimals], [no_commas])` |  |
| `JOIN` | `JOIN(delimiter, value, ...)` |  |
| `LEFT` | `LEFT(text, [num_chars])` |  |
| `LEFTB` | `LEFTB(text, [num_chars])` |  |
| `LEN` | `LEN(text)` |  |
| `LENB` | `LENB(text)` |  |
| `LOWER` | `LOWER(text)` |  |
| `MID` | `MID(text, start_num, num_chars)` |  |
| `MIDB` | `MIDB(text, start_num, num_chars)` |  |
| `NUMBERVALUE` | `NUMBERVALUE(text, [decimal_separator], [group_separator])` |  |
| `PHONETIC` | `PHONETIC(reference)` |  |
| `PROPER` | `PROPER(text)` |  |
| `REPLACE` | `REPLACE(old_text, start_num, num_chars, new_text)` |  |
| `REPLACEB` | `REPLACEB(old_text, start_num, num_chars, new_text)` |  |
| `REPT` | `REPT(text, number_times)` |  |
| `RIGHT` | `RIGHT(text, [num_chars])` |  |
| `RIGHTB` | `RIGHTB(text, [num_chars])` |  |
| `SEARCH` | `SEARCH(find_text, within_text, [start_num])` |  |
| `SEARCHB` | `SEARCHB(find_text, within_text, [start_num])` |  |
| `SPLIT` | `SPLIT(text, delimiter, [split_by_each], [remove_empty])` |  |
| `SUBSTITUTE` | `SUBSTITUTE(text, old_text, new_text, [instance_num])` |  |
| `T` | `T(value)` |  |
| `TEXT` | `TEXT(value, format_text)` |  |
| `TEXTAFTER` | `TEXTAFTER(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])` |  |
| `TEXTBEFORE` | `TEXTBEFORE(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])` |  |
| `TEXTJOIN` | `TEXTJOIN(delimiter, ignore_empty, text, ...)` |  |
| `TEXTSPLIT` | `TEXTSPLIT(text, [col_delimiter], [row_delimiter], [ignore_empty], [match_mode], [pad_with])` |  |
| `TRIM` | `TRIM(text)` |  |
| `UNICHAR` | `UNICHAR(number)` |  |
| `UNICODE` | `UNICODE(text)` |  |
| `UPPER` | `UPPER(text)` |  |
| `VALUE` | `VALUE(text)` |  |
| `VALUETOTEXT` | `VALUETOTEXT(value, [format])` |  |

## Regular expressions

| Function | Call | What it does |
| --- | --- | --- |
| `REGEXEXTRACT` | `REGEXEXTRACT(text, pattern, [return_mode], [case_sensitivity])` |  |
| `REGEXMATCH` | `REGEXMATCH(text, pattern)` |  |
| `REGEXREPLACE` | `REGEXREPLACE(text, pattern, replacement, [occurrence], [case_sensitivity])` |  |
| `REGEXTEST` | `REGEXTEST(text, pattern, [case_sensitivity])` |  |

## Date and time

| Function | Call | What it does |
| --- | --- | --- |
| `DATE` | `DATE(year, month, day)` |  |
| `DATEDIF` | `DATEDIF(start, end, unit)` |  |
| `DATEVALUE` | `DATEVALUE(text)` |  |
| `DAY` | `DAY(date)` |  |
| `DAYS` | `DAYS(end, start)` |  |
| `DAYS360` | `DAYS360(start, end, [european])` |  |
| `EDATE` | `EDATE(start, months)` |  |
| `EOMONTH` | `EOMONTH(start, months)` |  |
| `EPOCHTODATE` | `EPOCHTODATE(timestamp, [unit])` |  |
| `HOUR` | `HOUR(time)` |  |
| `ISOWEEKNUM` | `ISOWEEKNUM(date)` |  |
| `MINUTE` | `MINUTE(time)` |  |
| `MONTH` | `MONTH(date)` |  |
| `NETWORKDAYS` | `NETWORKDAYS(start, end, [holidays])` |  |
| `NETWORKDAYS.INTL` | `NETWORKDAYS.INTL(start, end, [weekend], [holidays])` |  |
| `NOW` | `NOW()` |  |
| `SECOND` | `SECOND(time)` |  |
| `TIME` | `TIME(hour, minute, second)` |  |
| `TIMEVALUE` | `TIMEVALUE(text)` |  |
| `TODAY` | `TODAY()` |  |
| `WEEKDAY` | `WEEKDAY(date, [type])` |  |
| `WEEKNUM` | `WEEKNUM(date, [type])` |  |
| `WORKDAY` | `WORKDAY(start, days, [holidays])` |  |
| `WORKDAY.INTL` | `WORKDAY.INTL(start, days, [weekend], [holidays])` |  |
| `YEAR` | `YEAR(date)` |  |
| `YEARFRAC` | `YEARFRAC(start, end, [basis])` |  |

## Lookup and reference

| Function | Call | What it does |
| --- | --- | --- |
| `ADDRESS` | `ADDRESS(row_num, column_num, [abs_num], [a1], [sheet_text])` |  |
| `AREAS` | `AREAS(reference)` |  |
| `CHOOSE` | `CHOOSE(index_num, value1, [value2], ...)` |  |
| `COLUMN` | `COLUMN([reference])` |  |
| `COLUMNS` | `COLUMNS(array)` |  |
| `FORMULATEXT` | `FORMULATEXT(reference)` |  |
| `HLOOKUP` | `HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])` |  |
| `HYPERLINK` | `HYPERLINK(link_location, [friendly_name])` |  |
| `INDEX` | `INDEX(array, [row_num], [column_num], [area_num])` |  |
| `INDIRECT` | `INDIRECT(ref_text, [a1])` |  |
| `LOOKUP` | `LOOKUP(lookup_value, lookup_vector, [result_vector])` |  |
| `MATCH` | `MATCH(lookup_value, lookup_array, [match_type])` |  |
| `OFFSET` | `OFFSET(reference, rows, cols, [height], [width])` |  |
| `ROW` | `ROW([reference])` |  |
| `ROWS` | `ROWS(array)` |  |
| `VLOOKUP` | `VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])` |  |
| `XLOOKUP` | `XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])` |  |
| `XMATCH` | `XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])` |  |

## Logic

| Function | Call | What it does |
| --- | --- | --- |
| `AND` | `AND(logical, ...)` |  |
| `BYCOL` | `BYCOL(array, lambda)` | Calls a function on each column of an array and gives one value per column. |
| `BYROW` | `BYROW(array, lambda)` | Calls a function on each row of an array and gives one value per row. |
| `FALSE` | `FALSE()` |  |
| `IF` | `IF(test, then, [otherwise])` |  |
| `IFERROR` | `IFERROR(value, on_error)` |  |
| `IFNA` | `IFNA(value, on_na)` |  |
| `IFS` | `IFS(test, result, ...)` |  |
| `LAMBDA` | `LAMBDA(parameter, ..., calculation)` |  |
| `LET` | `LET(name, value, ..., calculation)` |  |
| `MAKEARRAY` | `MAKEARRAY(rows, columns, lambda)` | Builds an array by calling a function with each cell’s row and column number. |
| `MAP` | `MAP(array, ..., lambda)` | Calls a function on each value of one or more arrays. |
| `NOT` | `NOT(logical)` |  |
| `OR` | `OR(logical, ...)` |  |
| `REDUCE` | `REDUCE([initial_value], array, lambda)` | Combines the values of an array into one result, a step at a time. |
| `SCAN` | `SCAN([initial_value], array, lambda)` | Combines the values of an array a step at a time and gives every step. |
| `SWITCH` | `SWITCH(value, match, result, ..., [default])` |  |
| `TRUE` | `TRUE()` |  |
| `XOR` | `XOR(logical, ...)` |  |

## Information

| Function | Call | What it does |
| --- | --- | --- |
| `CELL` | `CELL(info_type, [reference])` |  |
| `ERROR.TYPE` | `ERROR.TYPE(error)` |  |
| `INFO` | `INFO(type_text)` |  |
| `ISBLANK` | `ISBLANK(value)` |  |
| `ISDATE` | `ISDATE(value)` |  |
| `ISEMAIL` | `ISEMAIL(value)` |  |
| `ISERR` | `ISERR(value)` |  |
| `ISERROR` | `ISERROR(value)` |  |
| `ISEVEN` | `ISEVEN(number)` |  |
| `ISFORMULA` | `ISFORMULA(reference)` |  |
| `ISLOGICAL` | `ISLOGICAL(value)` |  |
| `ISNA` | `ISNA(value)` |  |
| `ISNONTEXT` | `ISNONTEXT(value)` |  |
| `ISNUMBER` | `ISNUMBER(value)` |  |
| `ISODD` | `ISODD(number)` |  |
| `ISOMITTED` | `ISOMITTED(argument)` |  |
| `ISREF` | `ISREF(value)` |  |
| `ISTEXT` | `ISTEXT(value)` |  |
| `ISURL` | `ISURL(value)` |  |
| `N` | `N(value)` |  |
| `NA` | `NA()` |  |
| `SHEET` | `SHEET([value])` |  |
| `SHEETS` | `SHEETS([reference])` |  |
| `TYPE` | `TYPE(value)` |  |
